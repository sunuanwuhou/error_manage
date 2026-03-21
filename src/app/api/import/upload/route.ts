import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { recognizeQuestionFromImage } from '@/lib/import/ocr'
import { parseDocxBuffer } from '@/lib/parsers/docx-parser'
import type { ParsedQuestion } from '@/lib/parsers/pdf-parser'
import { inferPaperSourceMeta } from '@/lib/paper-source'

const MAX_SIZE = 20 * 1024 * 1024

function normalizeOptionText(option: string) {
  return String(option || '')
    .replace(/^[A-DＡ-Ｄ][.\u3001\uff0e\)\uff09:\uff1a]\s*/i, '')
    .trim()
}

function normalizeBoolToken(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[^a-z\u4e00-\u9fa5]/g, '')
}

function isJudgeQuestion(question: ParsedQuestion) {
  const options = question.options.map(option => normalizeOptionText(option))
  const judgeTokens = new Set(['正确', '错误', '对', '错', 'true', 'false', 't', 'f'])

  if (options.length === 2 && options.every(option => judgeTokens.has(normalizeBoolToken(option)))) {
    return true
  }
  if (options.length > 0) return false

  const content = String(question.content || '')
  return /判断.*(?:对错|正误)|正确.*还是.*错误|下列说法.*(?:正确|错误)/.test(content)
}

function normalizeJudgeQuestion(question: ParsedQuestion): ParsedQuestion {
  if (!isJudgeQuestion(question)) return question

  const answerRaw = normalizeBoolToken(question.answer || '')
  let answer = 'A'
  if (['b', '错误', '错', 'false', 'f'].includes(answerRaw)) {
    answer = 'B'
  } else if (['a', '正确', '对', 'true', 't'].includes(answerRaw)) {
    answer = 'A'
  }

  return {
    ...question,
    type: '判断推理',
    options: ['A.正确', 'B.错误'],
    answer,
  }
}

function normalizeVerbalBlanks(content: string, type: string) {
  if (!type.includes('言语')) return content
  return String(content || '')
    .replace(/（\s*）/g, '（_）')
    .replace(/\(\s*\)/g, '(_)')
    .replace(/“\s+”/g, '“_”')
    .replace(/‘\s+’/g, '‘_’')
}

function trySplitInlineOptions(content: string, options: string[]) {
  if (options.length >= 2) return { content, options }

  const text = String(content || '')
    .replace(/[Ａ]/g, 'A')
    .replace(/[Ｂ]/g, 'B')
    .replace(/[Ｃ]/g, 'C')
    .replace(/[Ｄ]/g, 'D')
    .trim()
  if (!text) return { content, options }

  const marker = /([A-D])\s*[.\u3001\uff0e\)\uff09:\uff1a]\s*/g
  const matches = [...text.matchAll(marker)]
  if (matches.length < 4) return { content, options }

  const pos = new Map<string, number>()
  for (const letter of ['A', 'B', 'C', 'D']) {
    const hit = matches.find(item => item[1] === letter && typeof item.index === 'number')
    if (!hit || typeof hit.index !== 'number') return { content, options }
    pos.set(letter, hit.index)
  }
  const a = pos.get('A')!
  const b = pos.get('B')!
  const c = pos.get('C')!
  const d = pos.get('D')!
  if (!(a < b && b < c && c < d) || a <= 0) return { content, options }

  const buildOption = (from: number, to: number) => {
    const chunk = text.slice(from, to)
    const m = chunk.match(/^([A-D])\s*[.\u3001\uff0e\)\uff09:\uff1a]\s*([\s\S]*)$/)
    if (!m) return ''
    const body = normalizeOptionText(m[2])
    return body ? `${m[1]}.${body}` : ''
  }

  const nextOptions = [
    buildOption(a, b),
    buildOption(b, c),
    buildOption(c, d),
    buildOption(d, text.length),
  ].filter(Boolean)

  if (nextOptions.length < 4) return { content, options }
  return {
    content: text.slice(0, a).trim(),
    options: nextOptions,
  }
}

function normalizeImportedQuestion(question: ParsedQuestion): ParsedQuestion {
  const type = String(question.type || '')
  const withBlanks = normalizeVerbalBlanks(String(question.content || ''), type)
  const split = trySplitInlineOptions(withBlanks, question.options || [])
  return {
    ...question,
    content: split.content,
    options: split.options,
  }
}

function shouldRunOcr(question: ParsedQuestion) {
  if (!question.questionImage) return false
  const type = String(question.type || '')
  if (type.includes('资料分析')) return false
  if (type.includes('图形推理')) return false
  return true
}

function isImagePlaceholderOption(option: string) {
  const text = normalizeOptionText(option)
  return !text || text === '见图' || /\[图[A-D]?\]/.test(text)
}

function shouldUseOcrOptions(originalOptions: string[], ocrOptions: string[]) {
  if (ocrOptions.length < 2) return false
  if (originalOptions.length < 2) return true
  const placeholderCount = originalOptions.filter(isImagePlaceholderOption).length
  return placeholderCount >= Math.ceil(originalOptions.length / 2)
}

function looksLikeValidStem(content: string) {
  const text = String(content || '').trim()
  return text.length >= 8
}

function parseDataUrlToFile(dataUrl: string, name: string) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/)
  if (!match) return null
  const mimeType = match[1]
  const payload = match[2]
  const buffer = Buffer.from(payload, 'base64')
  return new File([buffer], name, { type: mimeType })
}

async function enhanceQuestionByOcr(question: ParsedQuestion): Promise<ParsedQuestion> {
  if (!shouldRunOcr(question)) return question
  if (!process.env.MINIMAX_API_KEY) return question

  const file = parseDataUrlToFile(question.questionImage || '', 'docx-question-image')
  if (!file) return question

  try {
    const ocr = await recognizeQuestionFromImage(file)
    const next: ParsedQuestion = { ...question }

    if (looksLikeValidStem(ocr.content) && ocr.content !== question.content) {
      next.content = ocr.content
    }

    if (shouldUseOcrOptions(question.options, ocr.options)) {
      next.options = ocr.options
    }

    if (!next.answer && ocr.answer) {
      next.answer = ocr.answer
    }

    if ((!next.analysis || next.analysis.length < 10) && ocr.analysis) {
      next.analysis = ocr.analysis
    }

    if ((!next.type || next.type.length < 2) && ocr.type) {
      next.type = ocr.type
    }

    return next
  } catch {
    return question
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const examType = (formData.get('examType') as string) || 'guo_kao'
  const srcName = (formData.get('srcName') as string) || ''

  if (!file) return NextResponse.json({ error: '请选择文件' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: '文件不能超过 20MB' }, { status: 400 })

  const fileName = file.name.toLowerCase()
  if (fileName.endsWith('.pdf')) {
    return NextResponse.json({ error: 'PDF 导入暂未开放，请先使用 DOCX 导入' }, { status: 400 })
  }
  if (fileName.endsWith('.doc')) {
    return NextResponse.json({ error: '暂不直接支持 .doc，请先另存为 .docx 后再导入' }, { status: 400 })
  }
  if (!fileName.endsWith('.docx')) {
    return NextResponse.json({ error: '当前仅支持 DOCX 导入，请上传 .docx 文件' }, { status: 400 })
  }

  const inferredMeta = inferPaperSourceMeta({
    fileName: file.name,
    srcName,
  })

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await parseDocxBuffer(buffer)

    let ocrEnhancedCount = 0
    const enhancedQuestions: ParsedQuestion[] = []
    for (const question of result.questions) {
      const enhanced = await enhanceQuestionByOcr(question)
      const normalized = normalizeImportedQuestion(enhanced)
      if (
        normalized.content !== question.content ||
        normalized.options.join('|') !== question.options.join('|') ||
        normalized.answer !== question.answer
      ) {
        ocrEnhancedCount += 1
      }
      enhancedQuestions.push(normalizeJudgeQuestion(normalized))
    }

    const warnings = [
      `DOCX 共解析到 ${enhancedQuestions.length} 道题`,
      ...result.warnings,
    ]
    if (ocrEnhancedCount > 0) {
      warnings.unshift(`OCR 增强修复 ${ocrEnhancedCount} 道图片题`)
    }

    if (enhancedQuestions.length === 0) {
      return NextResponse.json({ error: '未能解析出任何题目', warnings }, { status: 422 })
    }

    const indexedQuestions = enhancedQuestions.map((question, index) => ({ ...question, index }))
    const preview = indexedQuestions.slice(0, 50).map(question => ({
      index: question.index,
      no: question.no,
      content: question.content.slice(0, 120) + (question.content.length > 120 ? '...' : ''),
      questionImage: question.questionImage,
      options: question.options,
      answer: question.answer,
      type: question.type,
      hasAnalysis: Boolean(question.analysis),
    }))

    return NextResponse.json({
      total: enhancedQuestions.length,
      preview,
      warnings,
      inferredMeta,
      payload: Buffer.from(JSON.stringify(
        indexedQuestions.map(question => ({
          ...question,
          examType: inferredMeta.examType || examType,
          srcName: inferredMeta.srcName || srcName || file.name,
          srcOrigin: 'file_import',
        }))
      )).toString('base64'),
    })
  } catch (error: any) {
    return NextResponse.json({ error: `解析失败：${error?.message ?? 'unknown error'}` }, { status: 500 })
  }
}
