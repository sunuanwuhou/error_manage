// src/app/api/import/upload/route.ts
// 文件上传 + 解析（DOCX）
// 返回解析预览，不直接入库，等用户确认

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parseDocxBuffer } from '@/lib/parsers/docx-parser'

const MAX_SIZE = 20 * 1024 * 1024  // 20MB

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const formData = await req.formData()
  const file     = formData.get('file') as File | null
  const examType = (formData.get('examType') as string) || 'guo_kao'
  const srcName  = (formData.get('srcName')  as string) || ''

  if (!file) return NextResponse.json({ error: '请选择文件' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: '文件不能超过 20MB' }, { status: 400 })

  const filename = file.name.toLowerCase()
  const buffer   = Buffer.from(await file.arrayBuffer())

  let questions: any[] = []
  let warnings:  string[] = []

  try {
    if (filename.endsWith('.docx')) {
      // ---- DOCX 解析 ----
      const result = await parseDocxBuffer(buffer)
      questions    = result.questions
      warnings     = result.warnings
      warnings.unshift(`DOCX 共解析到 ${questions.length} 道题`)
    } else if (filename.endsWith('.doc')) {
      return NextResponse.json({ error: '暂不直接支持 .doc，请先另存为 .docx 后再导入' }, { status: 400 })
    } else {
      return NextResponse.json({ error: '当前只支持 DOCX 导入，请上传 .docx 文件' }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: `解析失败：${err.message}` }, { status: 500 })
  }

  if (questions.length === 0) {
    return NextResponse.json({ error: '未能解析出任何题目', warnings }, { status: 422 })
  }

  // 返回预览（前50题），完整数据 base64 存到响应里供确认接口用
  // 注意：不存数据库，让用户先预览确认
  const indexedQuestions = questions.map((q, i) => ({ ...q, index: i }))

  const preview = indexedQuestions.slice(0, 50).map((q) => ({
    index:    q.index,
    no:       q.no,
    content:  q.content.slice(0, 120) + (q.content.length > 120 ? '...' : ''),
    questionImage: q.questionImage,
    options:  q.options,
    answer:   q.answer,
    type:     q.type,
    hasAnalysis: !!q.analysis,
  }))

  return NextResponse.json({
    total:    questions.length,
    preview,
    warnings,
    // 完整数据 base64，提交确认时回传（避免存 session/DB）
    payload:  Buffer.from(JSON.stringify(
      indexedQuestions.map(q => ({ ...q, examType, srcName, srcOrigin: 'file_import' }))
    )).toString('base64'),
  })
}
