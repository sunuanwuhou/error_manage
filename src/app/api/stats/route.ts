// src/app/api/stats/route.ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getWeights } from '@/lib/daily-tasks'
import { calcStreak } from '@/lib/streak'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: userId },
    select: { examType: true, targetScore: true },
  })

  const weights = getWeights(user.examType)
  const errors = await prisma.userError.findMany({
    where:   { userId },
    include: { question: { select: { type: true } } },
  })

  const totalErrors         = errors.length
  const stockified          = errors.filter(e => e.isStockified).length
  const incrementCandidates = errors.filter(e => !e.isStockified && e.masteryPercent >= 60 && e.masteryPercent < 80).length
  const building            = errors.filter(e => !e.isStockified && e.masteryPercent >= 30 && e.masteryPercent < 60).length
  const skipped             = errors.filter(e => !e.isStockified && e.masteryPercent < 30).length

  const AVG_SKILLS = 5
  let stockifiedScore = 0
  let incrementScore  = 0
  const byType: Record<string, { stockified: number; total: number; masterySum: number }> = {}

  errors.forEach(e => {
    const type = e.question.type
    if (!byType[type]) byType[type] = { stockified: 0, total: 0, masterySum: 0 }
    byType[type].total++
    byType[type].masterySum += e.masteryPercent
    if (e.isStockified) byType[type].stockified++
    const w = weights[type] ?? 10
    const perSkill = w / AVG_SKILLS
    if (e.isStockified) stockifiedScore += perSkill
    else if (e.masteryPercent >= 60) incrementScore += perSkill * (e.masteryPercent / 100)
  })

  const sectionBreakdown = Object.entries(byType).map(([type, data]) => ({
    type,
    total:      data.total,
    stockified: data.stockified,
    masteryAvg: data.total > 0 ? Math.round(data.masterySum / data.total) : 0,
  }))

  const streakResult = await calcStreak(userId)

  return NextResponse.json({
    totalErrors, stockified, incrementCandidates, building, skipped,
    predictedScore:  Math.round(stockifiedScore + incrementScore),
    targetScore:     user.targetScore,
    stockifiedScore: Math.round(stockifiedScore),
    incrementScore:  Math.round(incrementScore),
    streak:          streakResult.current,
    streakBest:      streakResult.best,
    todayDone:       streakResult.today,
    sectionBreakdown,
  })
}
