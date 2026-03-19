// src/lib/section-stats.ts
// 每次答题后异步更新 UserSectionStats（预测分）§四 UserSectionStats

import { prisma } from './prisma'
import { getWeights } from './daily-tasks'

export async function updateSectionStats(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { examType: true, targetScore: true },
  })
  if (!user) return

  const weights = getWeights(user.examType)
  const AVG_SKILLS = 5

  // 从 UserError（错题复习）聚合各题型答对率
  const errors = await prisma.userError.findMany({
    where:   { userId, reviewCount: { gt: 0 } },
    include: { question: { select: { type: true } } },
  })

  // 从 PracticeRecord（真题练习）聚合答对率
  const practices = await prisma.practiceRecord.findMany({
    where:  { userId },
    select: { questionType: true, isCorrect: true },
  })

  const byType: Record<string, {
    correct: number
    total: number
    avgSeconds: number
    stockified: number
    incrementCandidates: number
    masterySum: number
  }> = {}

  errors.forEach(e => {
    const t = e.question.type
    if (!byType[t]) {
      byType[t] = {
        correct: 0,
        total: 0,
        avgSeconds: 0,
        stockified: 0,
        incrementCandidates: 0,
        masterySum: 0,
      }
    }
    byType[t].total++
    byType[t].masterySum += e.masteryPercent
    if (e.correctCount > 0) byType[t].correct += e.correctCount / Math.max(e.reviewCount, 1)
    if (e.isStockified) byType[t].stockified++
    else if (e.masteryPercent >= 60) byType[t].incrementCandidates++
  })

  practices.forEach(p => {
    const t = p.questionType ?? '未知'
    if (!byType[t]) {
      byType[t] = {
        correct: 0,
        total: 0,
        avgSeconds: 0,
        stockified: 0,
        incrementCandidates: 0,
        masterySum: 0,
      }
    }
    byType[t].total++
    if (p.isCorrect) byType[t].correct++
  })

  // 计算预测分
  let predictedScore = 0
  const statsJson: Record<string, any> = {}

  Object.entries(byType).forEach(([type, d]) => {
    const accuracy    = d.total > 0 ? d.correct / d.total : 0
    const scoreWeight = weights[type] ?? 0
    const perSkill = scoreWeight / AVG_SKILLS
    const conservativeScore = Math.min(scoreWeight, d.stockified * perSkill)
    const optimisticRaw = d.incrementCandidates * perSkill * 0.8
    const optimisticScore = Math.min(Math.max(scoreWeight - conservativeScore, 0), optimisticRaw)
    statsJson[type] = {
      correct:     Math.round(d.correct),
      total:       d.total,
      avgSeconds:  d.avgSeconds,
      target:      0.8,
      scoreWeight,
      accuracy:    Math.round(accuracy * 100),
      stockified:  d.stockified,
      incrementCandidates: d.incrementCandidates,
      masteryAvg: d.total > 0 ? Math.round(d.masterySum / d.total) : 0,
      conservativeScore: Math.round(conservativeScore * 10) / 10,
      optimisticScore: Math.round(optimisticScore * 10) / 10,
      remainingGap: Math.round(Math.max(scoreWeight - conservativeScore - optimisticScore, 0) * 10) / 10,
    }
    predictedScore += conservativeScore + optimisticScore
  })

  await prisma.userSectionStats.upsert({
    where:  { userId },
    update: { statsJson: JSON.stringify(statsJson), predictedScore: Math.round(predictedScore), updatedAt: new Date() },
    create: { userId, statsJson: JSON.stringify(statsJson), predictedScore: Math.round(predictedScore), targetScore: user.targetScore },
  })
}
