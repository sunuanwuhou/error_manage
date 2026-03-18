// src/app/api/activity/route.ts
// 活动日志查看 API（管理员 + 分析服务用）

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildActivitySummary } from '@/lib/activity/logger'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId   = (session.user as any).id
  const isAdmin  = (session.user as any).role === 'admin'

  const { searchParams } = new URL(req.url)
  const view = searchParams.get('view') ?? 'summary'  // summary | logs | snapshots | insights

  if (view === 'summary') {
    const days    = parseInt(searchParams.get('days') ?? '30')
    const summary = await buildActivitySummary(userId, days)
    return NextResponse.json(summary)
  }

  if (view === 'logs') {
    const limit = parseInt(searchParams.get('limit') ?? '50')
    const logs  = await prisma.activityLog.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      take:    Math.min(limit, 200),
      select:  { eventType: true, entityType: true, payload: true, hourOfDay: true, createdAt: true },
    })
    return NextResponse.json(logs.map(l => ({
      ...l,
      payload: JSON.parse(l.payload),
    })))
  }

  if (view === 'snapshots') {
    const snapshots = await prisma.$queryRawUnsafe<any[]>(`
      SELECT id, "analysisType", "confidenceScore", "dataPointsUsed",
             "wasActedUpon", "validationResult", "createdAt"
      FROM analysis_snapshots
      WHERE "userId" = $1 OR "userId" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT 20
    `, userId)
    return NextResponse.json(snapshots)
  }

  if (view === 'insights') {
    const insights = await prisma.$queryRawUnsafe<any[]>(`
      SELECT id, "insightCategory", "targetEntity", "paramKey",
             "paramValueOld", "paramValueNew", status, confidence,
             "appliedAt", "effectBefore", "effectAfter", "createdAt"
      FROM system_insights
      WHERE "userId" = $1 OR "userId" IS NULL
      ORDER BY confidence DESC, "createdAt" DESC
      LIMIT 20
    `, userId)
    return NextResponse.json(insights)
  }

  return NextResponse.json({ error: '未知 view' }, { status: 400 })
}
