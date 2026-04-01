import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { autoFixBatch } from '@/lib/import/auto-fix'
import { diffQuestion, summarizeDiff } from '@/lib/import/diff'
import { inferQuestionType } from '@/lib/import/quality-gate'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const job = await prisma.importJob.findFirst({ where: { id: params.id, userId } })
  if (!job) return NextResponse.json({ error: '导入任务不存在' }, { status: 404 })

  let parsedQuestions: any[] = []
  try {
    parsedQuestions = job.parsedQuestions ? JSON.parse(job.parsedQuestions) : []
  } catch {
    return NextResponse.json({ error: '导入任务题目解析失败' }, { status: 400 })
  }

  const normalized = parsedQuestions.map((raw, idx) => ({
    index: raw.index ?? idx,
    no: String(raw.no || idx + 1),
    content: String(raw.content || ''),
    questionImage: String(raw.questionImage || ''),
    options: Array.isArray(raw.options) ? raw.options.map((v: any) => String(v || '')) : [],
    answer: String(raw.answer || ''),
    type: String(raw.type || inferQuestionType(raw as any) || '单项选择题'),
    analysis: String(raw.analysis || ''),
    rawText: String(raw.rawText || ''),
  }))

  const fixed = autoFixBatch(normalized as any).items
  const diffItems = normalized.map((item, idx) => diffQuestion(item, fixed[idx] || item, idx))
  const summary = summarizeDiff(diffItems)

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    filename: job.filename,
    summary,
    items: diffItems.filter(item => item.changed).slice(0, 80),
  })
}
