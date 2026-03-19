// src/app/api/stats/route.ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getWeights, getDailyTaskStrategySnapshot } from '@/lib/daily-tasks'
import { calcStreak } from '@/lib/streak'
import { EVENT_TYPES } from '@/lib/activity/logger'
import { differenceInDays } from 'date-fns'

const AVG_SKILLS = 5

function round1(value: number) {
  return Math.round(value * 10) / 10
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: userId },
    select: { examType: true, targetScore: true, examDate: true, dailyGoal: true },
  })

  const strategySnapshot = await getDailyTaskStrategySnapshot(userId, {
    examType: user.examType,
    examDate: user.examDate,
    dailyGoal: user.dailyGoal,
  })
  const daysToExam = user.examDate
    ? differenceInDays(new Date(user.examDate), new Date())
    : null

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

  let stockifiedScore = 0
  let incrementScore  = 0
  const byType: Record<string, {
    stockified: number
    total: number
    masterySum: number
    incrementCandidates: number
    scoreWeight: number
    conservativeScore: number
    optimisticScore: number
    remainingGap: number
  }> = {}

  errors.forEach(e => {
    const type = e.question.type
    if (!byType[type]) {
      byType[type] = {
        stockified: 0,
        total: 0,
        masterySum: 0,
        incrementCandidates: 0,
        scoreWeight: weights[type] ?? 10,
        conservativeScore: 0,
        optimisticScore: 0,
        remainingGap: 0,
      }
    }
    byType[type].total++
    byType[type].masterySum += e.masteryPercent
    if (e.isStockified) byType[type].stockified++
    else if (e.masteryPercent >= 60) byType[type].incrementCandidates++
  })

  Object.values(byType).forEach(section => {
    const perSkill = section.scoreWeight / AVG_SKILLS
    section.conservativeScore = Math.min(section.scoreWeight, section.stockified * perSkill)
    const optimisticRaw = section.incrementCandidates * perSkill * 0.8
    section.optimisticScore = Math.min(Math.max(section.scoreWeight - section.conservativeScore, 0), optimisticRaw)
    section.remainingGap = Math.max(
      section.scoreWeight - section.conservativeScore - section.optimisticScore,
      0
    )
    stockifiedScore += section.conservativeScore
    incrementScore += section.optimisticScore
  })

  const sectionBreakdown = Object.entries(byType).map(([type, data]) => ({
    type,
    total:      data.total,
    stockified: data.stockified,
    masteryAvg: data.total > 0 ? Math.round(data.masterySum / data.total) : 0,
    incrementCandidates: data.incrementCandidates,
    scoreWeight: round1(data.scoreWeight),
    conservativeScore: round1(data.conservativeScore),
    optimisticScore: round1(data.optimisticScore),
    remainingGap: round1(data.remainingGap),
  }))

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [todayActivity, todayStockifiedEvents] = await Promise.all([
    prisma.activityLog.findMany({
      where: {
        userId,
        eventType: EVENT_TYPES.PRACTICE_ANSWER,
        createdAt: { gte: startOfToday },
      },
      select: { payload: true },
    }),
    prisma.activityLog.findMany({
      where: {
        userId,
        eventType: EVENT_TYPES.ERROR_STOCKIFIED,
        createdAt: { gte: startOfToday },
      },
      select: { payload: true },
    }),
  ])

  let todayMasteryGain = 0
  let todayOptimisticGain = 0
  let todayCorrect = 0

  todayActivity.forEach(row => {
    try {
      const payload = JSON.parse(row.payload) as {
        masteryBefore?: number
        masteryAfter?: number
        questionType?: string
        isCorrect?: boolean
      }
      const before = payload.masteryBefore ?? 0
      const after = payload.masteryAfter ?? before
      const delta = Math.max(0, after - before)
      todayMasteryGain += delta
      const typeWeight = weights[payload.questionType ?? ''] ?? 10
      todayOptimisticGain += (delta / 100) * (typeWeight / AVG_SKILLS)
      if (payload.isCorrect) todayCorrect++
    } catch {}
  })

  let todayConservativeGain = 0
  const todayStockifiedByType: Record<string, number> = {}
  todayStockifiedEvents.forEach(row => {
    try {
      const payload = JSON.parse(row.payload) as { questionType?: string }
      const type = payload.questionType ?? '未知'
      todayStockifiedByType[type] = (todayStockifiedByType[type] ?? 0) + 1
      const typeWeight = weights[type] ?? 10
      todayConservativeGain += typeWeight / AVG_SKILLS
    } catch {}
  })

  const todayEstimatedGain = todayConservativeGain + todayOptimisticGain
  const conservativeScoreRounded = round1(stockifiedScore)
  const optimisticScoreRounded = round1(incrementScore)
  const gapSources = sectionBreakdown
    .filter(section => section.remainingGap > 0)
    .sort((a, b) => b.remainingGap - a.remainingGap)
    .slice(0, 3)
    .map(section => ({
      type: section.type,
      remainingGap: section.remainingGap,
      conservativeScore: section.conservativeScore,
      optimisticScore: section.optimisticScore,
      scoreWeight: section.scoreWeight,
      hint:
        section.conservativeScore < section.scoreWeight * 0.5
          ? '先补存量底线'
          : section.incrementCandidates > 0
            ? '优先把增量候选推过门槛'
            : '先做题扩充可激活池',
    }))

  const nextFocus = gapSources[0] ?? null
  const nextAction = nextFocus
    ? {
        title: `优先攻 ${nextFocus.type}`,
        reason: `还差 ${nextFocus.remainingGap} 分最明显，当前${nextFocus.hint}。`,
      }
    : {
        title: '继续稳住已建立的节奏',
        reason: '当前主要题型都已形成基础盘，优先保持日更和整卷训练。',
      }

  const streakResult = await calcStreak(userId)

  return NextResponse.json({
    totalErrors, stockified, incrementCandidates, building, skipped,
    predictedScore:  Math.round(stockifiedScore + incrementScore),
    targetScore:     user.targetScore,
    stockifiedScore: conservativeScoreRounded,
    incrementScore:  optimisticScoreRounded,
    conservativeScore: conservativeScoreRounded,
    optimisticScore: round1(stockifiedScore + incrementScore),
    todayPracticeCount: todayActivity.length,
    todayCorrect,
    todayMasteryGain: Math.round(todayMasteryGain),
    todayConservativeGain: round1(todayConservativeGain),
    todayOptimisticGain: round1(todayOptimisticGain),
    todayEstimatedGain: round1(todayEstimatedGain),
    todayStockifiedCount: todayStockifiedEvents.length,
    gapSources,
    nextAction,
    streak:          streakResult.current,
    streakBest:      streakResult.best,
    todayDone:       streakResult.today,
    sectionBreakdown,
    strategySnapshot: {
      activeInsight: strategySnapshot.activeInsight,
      activeInsightSummary: strategySnapshot.activeInsightSummary,
      playbook: strategySnapshot.playbook,
      mode: strategySnapshot.mode,
      totalTarget: strategySnapshot.totalTarget,
      errorLimit: strategySnapshot.errorLimit,
      guardLimit: strategySnapshot.guardLimit,
      activationThresholdDays: strategySnapshot.activationThresholdDays,
      daysToExam,
    },
  })
}
