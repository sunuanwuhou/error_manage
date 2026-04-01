import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { autoFixBatch } from '@/lib/import/auto-fix'
import { evaluateImportQuality, inferQuestionType } from '@/lib/import/quality-gate'

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
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
    questionImage: raw.questionImage || '',
    options: Array.isArray(raw.options) ? raw.options.map((v: any) => String(v || '')) : [],
    answer: String(raw.answer || ''),
    type: String(raw.type || inferQuestionType(raw as any) || '单项选择题'),
    analysis: String(raw.analysis || ''),
    rawText: String(raw.rawText || ''),
    examType: String(raw.examType || ''),
    srcName: String(raw.srcName || ''),
    srcOrigin: String(raw.srcOrigin || ''),
    fileName: String(raw.fileName || ''),
    relativePath: String(raw.relativePath || ''),
  }))

  const beforeBlocked = normalized.filter(item => evaluateImportQuality(item as any).blockers.length).length
  const result = autoFixBatch(normalized as any)
  const afterBlocked = result.items.filter(item => evaluateImportQuality(item as any).blockers.length).length

  const updated = await prisma.importJob.update({
    where: { id: job.id },
    data: {
      parsedQuestions: JSON.stringify(result.items),
      status: job.status === 'parsed' ? 'reviewing' : job.status,
    },
  })

  return NextResponse.json({
    ok: true,
    job: {
      id: updated.id,
      filename: updated.filename,
      status: updated.status,
    },
    stats: result.stats,
    beforeBlocked,
    afterBlocked,
    repairedCount: Math.max(0, beforeBlocked - afterBlocked),
    recommendedIndexes: result.recommendedIndexes,
    problemIndexes: result.problemIndexes,
  })
}
