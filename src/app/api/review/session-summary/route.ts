// src/app/api/review/session-summary/route.ts
// 练习结束后查询本次涨幅

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const since = searchParams.get('since')  // ISO 时间，本次练习开始时间
  if (!since) return NextResponse.json({ error: '缺少 since 参数' }, { status: 400 })

  const sinceDate = new Date(since)

  // 本次练习的所有提交记录
  const records = await prisma.reviewRecord.findMany({
    where:   { userId, createdAt: { gte: sinceDate } },
    include: { userError: { include: { question: { select: { type: true } } } } },
    orderBy: { createdAt: 'asc' },
  })

  const total       = records.length
  const correct     = records.filter(r => r.isCorrect).length
  const newStockified = records.filter(r => r.userError.isStockified).length  // 本次练习后已存量化的
  const slowCorrect = records.filter(r => r.isSlowCorrect).length

  // 按题型统计正确率
  const byType: Record<string, { correct: number; total: number }> = {}
  records.forEach(r => {
    const t = r.userError.question.type
    if (!byType[t]) byType[t] = { correct: 0, total: 0 }
    byType[t].total++
    if (r.isCorrect) byType[t].correct++
  })

  // 今日新增存量化的具体题目（isStockified=true 且最近一次更新在 since 之后）
  const todayStockified = await prisma.userError.findMany({
    where:   { userId, isStockified: true, updatedAt: { gte: sinceDate } },
    include: { question: { select: { type: true, subtype: true } } },
    take: 5,
  })

  return NextResponse.json({
    total, correct, newStockified: todayStockified.length,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    slowCorrect,
    byType: Object.entries(byType).map(([type, d]) => ({
      type,
      accuracy: Math.round((d.correct / d.total) * 100),
      total:    d.total,
    })),
    stockifiedItems: todayStockified.map(e => ({
      type: e.question.type,
      subtype: e.question.subtype,
      masteryPercent: e.masteryPercent,
    })),
  })
}
