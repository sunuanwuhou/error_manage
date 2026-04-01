import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildImportJobInsight, parseImportJobQuestions } from '@/lib/import/import-job-insights'
import { evaluateImportQuality, inferQuestionType } from '@/lib/import/quality-gate'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const job = await prisma.importJob.findFirst({
    where: { id: params.id, userId },
  })
  if (!job) return NextResponse.json({ error: '导入任务不存在' }, { status: 404 })

  const questions = parseImportJobQuestions(job.parsedQuestions)
  const insight = buildImportJobInsight(questions)
  const blockedQuestions = questions.map((raw, idx) => {
    const item = {
      index: raw.index ?? idx,
      no: String(raw.no || idx + 1),
      content: String(raw.content || ''),
      questionImage: String(raw.questionImage || ''),
      options: Array.isArray(raw.options) ? raw.options.map(v => String(v || '')) : [],
      answer: String(raw.answer || ''),
      type: inferQuestionType(raw as any),
      analysis: String(raw.analysis || ''),
      fileName: String(raw.fileName || ''),
      relativePath: String(raw.relativePath || ''),
    }
    const quality = evaluateImportQuality(item as any)
    if (!quality.blockers.length) return null
    return {
      index: item.index,
      no: item.no,
      content: item.content,
      fileName: item.fileName,
      relativePath: item.relativePath,
      blockers: quality.blockers.map(issue => issue.label),
    }
  }).filter(Boolean)

  return NextResponse.json({
    job: {
      id: job.id,
      filename: job.filename,
      status: job.status,
      createdAt: job.createdAt,
      importedCount: job.importedCount,
    },
    insight,
    releaseAdvice: {
      canPublishAll: insight.total > 0 && insight.blockedCount === 0,
      canPublishRecommendedSubset: insight.recommendedPublishIndexes.length > 0,
      recommendedPublishIndexes: insight.recommendedPublishIndexes,
      blockedQuestions: blockedQuestions.slice(0, 100),
      focusFiles: insight.fileBreakdown.filter(item => item.blockedCount > 0).slice(0, 20),
    },
  })
}
