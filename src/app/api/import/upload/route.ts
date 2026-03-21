import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { parseDocxBuffer } from '@/lib/parsers/docx-parser'
import { parsePdfBuffer } from '@/lib/parsers/pdf-parser'
import { inferPaperSourceMeta } from '@/lib/paper-source'

const MAX_SIZE = 20 * 1024 * 1024

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
  const buffer = Buffer.from(await file.arrayBuffer())
  const inferredMeta = inferPaperSourceMeta({
    fileName: file.name,
    srcName,
  })

  let questions: any[] = []
  let warnings: string[] = []

  try {
    if (fileName.endsWith('.docx')) {
      const result = await parseDocxBuffer(buffer)
      questions = result.questions
      warnings = [`DOCX 共解析到 ${result.questions.length} 道题`, ...result.warnings]
    } else if (fileName.endsWith('.pdf')) {
      const result = await parsePdfBuffer(buffer)
      questions = result.questions
      warnings = [`PDF 共解析到 ${result.questions.length} 道题`, ...result.warnings]
    } else if (fileName.endsWith('.doc')) {
      return NextResponse.json({ error: '暂不直接支持 .doc，请先另存为 .docx 后再导入' }, { status: 400 })
    } else {
      return NextResponse.json({ error: '当前只支持 PDF 或 DOCX 导入，请上传 .pdf 或 .docx 文件' }, { status: 400 })
    }
  } catch (error: any) {
    return NextResponse.json({ error: `解析失败：${error?.message ?? 'unknown error'}` }, { status: 500 })
  }

  if (questions.length === 0) {
    return NextResponse.json({ error: '未能解析出任何题目', warnings }, { status: 422 })
  }

  const indexedQuestions = questions.map((question, index) => ({ ...question, index }))
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
    total: questions.length,
    preview,
    warnings,
    inferredMeta,
    payload: Buffer.from(JSON.stringify(
      indexedQuestions.map(question => ({
        ...question,
        examType,
        srcName,
        srcOrigin: 'file_import',
      }))
    )).toString('base64'),
  })
}
