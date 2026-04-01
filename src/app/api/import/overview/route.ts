import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildImportJobInsight } from '@/lib/import/import-job-insights'

export async function GET(_: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const jobs = await prisma.importJob.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const blockerMap: Record<string, number> = {}
  const warningMap: Record<string, number> = {}
  let totalQuestions = 0
  let readyQuestions = 0
  let blockedQuestions = 0
  let warningQuestions = 0

  const items = jobs.map(job => {
    const insight = buildImportJobInsight(job.parsedQuestions)
    totalQuestions += insight.total
    readyQuestions += insight.readyCount
    blockedQuestions += insight.blockedCount
    warningQuestions += insight.warningCount
    insight.blockerReasons.forEach(item => {
      blockerMap[item.label] = (blockerMap[item.label] || 0) + item.count
    })
    insight.warningReasons.forEach(item => {
      warningMap[item.label] = (warningMap[item.label] || 0) + item.count
    })

    const readyStatus = insight.total > 0 && insight.blockedCount === 0 ? 'ready' : insight.total > 0 && insight.readyCount > 0 ? 'partial' : 'blocked'

    return {
      id: job.id,
      filename: job.filename,
      status: job.status,
      importedCount: job.importedCount,
      createdAt: job.createdAt,
      failReason: job.failReason,
      insight: {
        total: insight.total,
        readyCount: insight.readyCount,
        blockedCount: insight.blockedCount,
        warningCount: insight.warningCount,
        topBlocker: insight.blockerReasons[0]?.label || '',
        topWarning: insight.warningReasons[0]?.label || '',
      },
      releaseStatus: readyStatus,
    }
  })

  const releaseBuckets = {
    readyJobs: items.filter(item => item.releaseStatus === 'ready').length,
    partialJobs: items.filter(item => item.releaseStatus === 'partial').length,
    blockedJobs: items.filter(item => item.releaseStatus === 'blocked').length,
  }

  return NextResponse.json({
    summary: {
      jobs: items.length,
      totalQuestions,
      readyQuestions,
      blockedQuestions,
      warningQuestions,
      ...releaseBuckets,
    },
    topBlockers: Object.entries(blockerMap).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    topWarnings: Object.entries(warningMap).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    items,
  })
}
