import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { parseDocxBuffer } from '@/lib/parsers/docx-parser'
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
    const questions = result.questions
    const warnings = [`DOCX 共解析到 ${questions.length} 道题`, ...result.warnings]

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
          examType: inferredMeta.examType || examType,
          srcName: inferredMeta.srcName || srcName || file.name,
          srcOrigin: 'file_import',
        })),
      )).toString('base64'),
    })
  } catch (error: any) {
    return NextResponse.json({ error: `解析失败：${error?.message ?? 'unknown error'}` }, { status: 500 })
  }
}
