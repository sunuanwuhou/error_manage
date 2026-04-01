import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { recognizeQuestionFromImage } from '@/lib/import/ocr'
import { parseDocxBuffer, type ParsedQuestion } from '@/lib/parsers/docx-parser'
import { inferPaperSourceMeta } from '@/lib/paper-source'
import { createImportJob } from '@/lib/import/import-job'

const MAX_SIZE = 20 * 1024 * 1024
const MAX_BATCH_FILES = 200

function normalizeAnswerText(answer: string) {
  return String(answer || '')
    .trim()
    .replace(/[Ａ-Ｄ]/g, s => String.fromCharCode(s.charCodeAt(0) - 65248))
    .replace(/对/g, '正确')
    .replace(/错/g, '错误')
    .toUpperCase()
}

function parseStructuredText(text: string): ParsedQuestion[] {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const questions: ParsedQuestion[] = []
  let current: ParsedQuestion | null = null
  const qRe = /^\s*(\d{1,3})[\.．、]\s*(.+)$/
  const optRe = /^\s*([A-DＡ-Ｄ])[\.．、\)）:：]\s*(.+)$/
  const ansRe = /^\s*(?:答案|参考答案)\s*[:：]\s*(.+)$/
  const anaRe = /^\s*(?:解析|答案解析|参考解析)\s*[:：]\s*(.*)$/

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const q = line.match(qRe)
    if (q) {
      if (current) questions.push(current)
      current = { no: q[1], content: q[2].trim(), options: [], answer: '', type: '单项选择题', analysis: '', rawText: line }
      continue
    }
    if (!current) continue
    const opt = line.match(optRe)
    if (opt) {
      const key = opt[1].replace(/[Ａ-Ｄ]/g, s => String.fromCharCode(s.charCodeAt(0) - 65248))
      current.options.push(`${key}.${opt[2].trim()}`)
      continue
    }
    const ans = line.match(ansRe)
    if (ans) {
      current.answer = normalizeAnswerText(ans[1])
      continue
    }
    const ana = line.match(anaRe)
    if (ana) {
      current.analysis = [current.analysis || '', ana[1].trim()].filter(Boolean).join('\n')
      continue
    }
    if (current.options.length) current.analysis = [current.analysis || '', line].filter(Boolean).join('\n')
    else current.content = `${current.content}\n${line}`.trim()
  }
  if (current) questions.push(current)
  return questions
}

function parseJsonQuestions(text: string): ParsedQuestion[] {
  const data = JSON.parse(text)
  const list = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : []
  return list.map((item: any, index: number) => ({
    no: String(item.no || item.questionNo || index + 1),
    content: String(item.content || item.stem || '').trim(),
    questionImage: String(item.questionImage || item.image || '').trim(),
    options: Array.isArray(item.options) ? item.options.map((v: any) => String(v || '').trim()).filter(Boolean) : [],
    answer: normalizeAnswerText(String(item.answer || '')),
    type: String(item.type || '单项选择题').trim(),
    analysis: String(item.analysis || '').trim(),
    rawText: String(item.rawText || '').trim(),
  }))
}


function normalizeOptionText(option: string) {
  return String(option || '').replace(/^[A-DＡ-Ｄ][.\u3001\uff0e\)\uff09:\uff1a]\s*/i, '').trim()
}

function normalizeJudgeQuestion(question: ParsedQuestion): ParsedQuestion {
  const options = (question.options || []).map(normalizeOptionText)
  const judgeLike = options.length === 2 && options.every(item => /正确|错误|对|错/.test(item))
  if (!judgeLike) return question
  const answerRaw = String(question.answer || '').trim().toUpperCase()
  const answer = ['B', '错误', '错'].includes(answerRaw) ? 'B' : 'A'
  return { ...question, type: '判断推理', options: ['A.正确', 'B.错误'], answer }
}

function normalizeQuestion(question: ParsedQuestion) {
  return {
    ...question,
    content: String(question.content || '').replace(/（\s*）/g, '（_）').replace(/\(\s*\)/g, '(_)'),
  }
}

async function enhanceQuestionByOcr(question: ParsedQuestion): Promise<ParsedQuestion> {
  if (!question.questionImage) return question
  if (/资料分析|图形推理/.test(String(question.type || ''))) return question

  const match = String(question.questionImage).match(/^data:(.+?);base64,(.+)$/)
  if (!match) return question
  const mime = match[1]
  const b64 = match[2]
  const file = new File([Buffer.from(b64, 'base64')], 'question-image.png', { type: mime })

  try {
    const ocr = await recognizeQuestionFromImage(file)
    return {
      ...question,
      content: ocr.content && ocr.content.length > (question.content || '').length ? ocr.content : question.content,
      options: (ocr.options && ocr.options.length >= 2) ? ocr.options : question.options,
      answer: question.answer || ocr.answer || '',
      analysis: question.analysis || ocr.analysis || '',
      type: question.type || ocr.type || '单项选择题',
    }
  } catch {
    return question
  }
}



type ParseFileResult = {
  indexedQuestions: any[]
  warnings: string[]
  inferredMeta: ReturnType<typeof inferPaperSourceMeta>
}

async function parseImportFile(params: { file: File; examType: string; srcName: string; displayName?: string }): Promise<ParseFileResult> {
  const { file, examType, srcName, displayName } = params
  const fileName = file.name.toLowerCase()
  const fileLabel = displayName || file.name
  const inferredMeta = inferPaperSourceMeta({ fileName: fileLabel, srcName })
  let indexedQuestions: any[] = []
  const warnings: string[] = []

  if (fileName.endsWith('.docx')) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await parseDocxBuffer(buffer)
    let enhancedCount = 0
    const questions: ParsedQuestion[] = []
    for (const raw of result.questions) {
      const ocrEnhanced = await enhanceQuestionByOcr(raw)
      if (
        ocrEnhanced.content !== raw.content ||
        (ocrEnhanced.options || []).join('|') !== (raw.options || []).join('|') ||
        ocrEnhanced.answer !== raw.answer
      ) enhancedCount += 1
      questions.push(normalizeJudgeQuestion(normalizeQuestion(ocrEnhanced)))
    }
    indexedQuestions = questions.map((q, index) => ({
      ...q,
      index,
      examType: inferredMeta.examType || examType,
      srcName: inferredMeta.srcName || srcName || fileLabel,
      srcOrigin: 'file_import',
    }))
    warnings.push(...result.warnings)
    if (enhancedCount > 0) warnings.unshift(`OCR 增强修复 ${enhancedCount} 道图片题`)
    warnings.unshift(`DOCX 共解析到 ${indexedQuestions.length} 道题`)
  } else if (/\.(json)$/i.test(fileName)) {
    const raw = await file.text()
    const questions = parseJsonQuestions(raw).map((q, index) => ({
      ...normalizeJudgeQuestion(normalizeQuestion(q)),
      index,
      examType: inferredMeta.examType || examType,
      srcName: inferredMeta.srcName || srcName || fileLabel,
      srcOrigin: 'json_import',
    }))
    indexedQuestions = questions
    warnings.unshift(`JSON 共解析到 ${indexedQuestions.length} 道题`)
  } else if (/\.(txt|md)$/i.test(fileName)) {
    const raw = await file.text()
    const questions = parseStructuredText(raw).map((q, index) => ({
      ...normalizeJudgeQuestion(normalizeQuestion(q)),
      index,
      examType: inferredMeta.examType || examType,
      srcName: inferredMeta.srcName || srcName || fileLabel,
      srcOrigin: 'text_import',
    }))
    indexedQuestions = questions
    warnings.unshift(`文本共解析到 ${indexedQuestions.length} 道题`)
    warnings.push('TXT/MD 导入要求使用“1.题干 / A.选项 / 答案：A / 解析：...”结构。')
  } else if (/\.(png|jpg|jpeg|bmp|webp)$/i.test(fileName)) {
    const ocr = await recognizeQuestionFromImage(file)
    indexedQuestions = [{
      index: 0,
      no: '1',
      content: ocr.content,
      questionImage: '',
      options: ocr.options,
      answer: ocr.answer || '',
      type: ocr.type || '单项选择题',
      analysis: ocr.analysis || '',
      rawText: ocr.rawText || '',
      examType: inferredMeta.examType || examType,
      srcName: inferredMeta.srcName || srcName || fileLabel,
      srcOrigin: 'image_import',
    }]
    warnings.push('当前为单图导入模式，适合单题补录或截图补录。')
  } else {
    throw new Error(`文件 ${fileLabel} 格式不支持`)
  }

  return { indexedQuestions, warnings, inferredMeta }
}
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const files = formData.getAll('files').filter(Boolean) as File[]
  const relativePaths = formData.getAll('relativePaths').map(item => String(item || ''))
  const examType = (formData.get('examType') as string) || 'guo_kao'
  const srcName = (formData.get('srcName') as string) || ''

  const inputFiles = (files.length ? files : file ? [file] : []).filter(Boolean)
  if (!inputFiles.length) return NextResponse.json({ error: '请选择文件' }, { status: 400 })
  if (inputFiles.length > MAX_BATCH_FILES) {
    return NextResponse.json({ error: `单次最多导入 ${MAX_BATCH_FILES} 个文件` }, { status: 400 })
  }

  for (const item of inputFiles) {
    if (item.size > MAX_SIZE) {
      return NextResponse.json({ error: `文件 ${item.name} 不能超过 20MB` }, { status: 400 })
    }
  }

  try {
    const mergedQuestions: any[] = []
    const warnings: string[] = []
    const fileSummaries: any[] = []
    let inferredMeta = inferPaperSourceMeta({ fileName: inputFiles[0]?.name || '', srcName })

    for (let idx = 0; idx < inputFiles.length; idx += 1) {
      const currentFile = inputFiles[idx]
      const relativePath = relativePaths[idx] || ''
      const displayName = relativePath || currentFile.name
      try {
        const result = await parseImportFile({ file: currentFile, examType, srcName, displayName })
        if (!mergedQuestions.length) inferredMeta = result.inferredMeta
        const offset = mergedQuestions.length
        const normalized = result.indexedQuestions.map((q, qIndex) => ({
          ...q,
          index: offset + qIndex,
          fileName: currentFile.name,
          relativePath,
        }))
        mergedQuestions.push(...normalized)
        fileSummaries.push({
          fileName: currentFile.name,
          relativePath,
          total: normalized.length,
          warnings: result.warnings,
          status: 'parsed',
        })
        warnings.push(`[${displayName}] ${normalized.length} 道题`)
        result.warnings.forEach(item => warnings.push(`[${displayName}] ${item}`))
      } catch (error: any) {
        fileSummaries.push({
          fileName: currentFile.name,
          relativePath,
          total: 0,
          warnings: [String(error?.message || '解析失败')],
          status: 'skipped',
        })
        warnings.push(`[${displayName}] 跳过：${String(error?.message || '解析失败')}`)
      }
    }

    if (!mergedQuestions.length) {
      return NextResponse.json({ error: '未能解析出任何题目', warnings }, { status: 422 })
    }

    const preview = mergedQuestions.slice(0, 200).map(question => ({
      index: question.index,
      no: question.no,
      content: question.content.slice(0, 120) + (question.content.length > 120 ? '...' : ''),
      questionImage: question.questionImage,
      options: question.options,
      answer: question.answer,
      type: question.type,
      hasAnalysis: Boolean(question.analysis),
      rawText: question.rawText,
      fileName: question.fileName,
      relativePath: question.relativePath,
    }))

    const batchLabel = inputFiles.length > 1 ? `batch_${inputFiles.length}_files` : inputFiles[0].name
    const importJob = await createImportJob({
      userId,
      filename: batchLabel,
      parsedQuestions: JSON.stringify(mergedQuestions),
      status: 'parsed',
    })

    return NextResponse.json({
      importJobId: importJob.id,
      total: mergedQuestions.length,
      preview,
      warnings,
      inferredMeta,
      fileSummaries,
      isBatch: inputFiles.length > 1,
      batchFileCount: inputFiles.length,
      payload: Buffer.from(JSON.stringify(mergedQuestions)).toString('base64'),
    })
  } catch (error: any) {
    return NextResponse.json({ error: `解析失败：${error?.message ?? 'unknown error'}` }, { status: 500 })
  }
}
