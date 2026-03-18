// lib/mastery-engine.ts
// ============================================================
// P0 核心引擎：mastery 更新 + 间隔复习调度
// 对应方案文档 §6.2 §6.3 §6.3a §6.3b §6.3c
// ============================================================

import { differenceInDays, addDays } from 'date-fns'
import type { UserError, ReviewRecord } from '@prisma/client'

// ===== 间隔序列（全系统唯一定义）=====
export const INTERVAL_SEQUENCE = [1, 3, 7, 15, 30] as const

// interval 档位 → 基础 masteryPercent 映射
const INTERVAL_TO_MASTERY: Record<number, number> = {
  1:  20,
  3:  40,
  7:  60,
  15: 75,
  30: 95,
}

// ===== 速度警戒线（秒/题，对应 §6.7）=====
export const SPEED_LIMITS: Record<string, number> = {
  '资料分析': 180,
  '逻辑判断': 90,
  '言语理解': 45,
  '数量关系': 210,
  '常识判断': 30,
  '图形推理': 45,
  '类比推理': 30,
  '定义判断': 60,
}

// ===== 1. masteryPercent 更新（§6.3）=====
export function updateMastery(
  userError: Pick<UserError, 'masteryPercent' | 'reviewInterval'>,
  record: Pick<ReviewRecord, 'isCorrect' | 'thinkingVerdict' | 'isSlowCorrect'>
): number {
  const base = INTERVAL_TO_MASTERY[userError.reviewInterval] ?? 20
  let mastery = base

  // 质量修正
  if (record.thinkingVerdict === 'correct') mastery += 5  // 思路完全正确 +5%
  if (record.isSlowCorrect)                mastery -= 10  // 慢正确 -10%

  // 夹到 [0, 100]
  mastery = Math.min(100, Math.max(0, mastery))

  // 答错：不归零，保留底部记忆
  if (!record.isCorrect) {
    mastery = Math.max(userError.masteryPercent - 30, 10)
  }

  return mastery
}

// ===== 2. interval 升降级（§6.1）=====
export function updateInterval(
  currentInterval: number,
  record: Pick<ReviewRecord, 'isCorrect' | 'thinkingVerdict' | 'isSlowCorrect'>
): number {
  const idx = INTERVAL_SEQUENCE.indexOf(currentInterval as typeof INTERVAL_SEQUENCE[number])
  const currentIdx = idx === -1 ? 0 : idx

  if (!record.isCorrect) {
    // 答错：回到 interval=1
    return 1
  }

  if (record.isSlowCorrect) {
    // 慢正确：不升档（interval 原值不变）
    return currentInterval
  }

  if (record.thinkingVerdict === 'correct') {
    // 答对 + 思路正确：升一档
    const nextIdx = Math.min(currentIdx + 1, INTERVAL_SEQUENCE.length - 1)
    return INTERVAL_SEQUENCE[nextIdx]
  }

  if (record.thinkingVerdict === 'partial' || record.thinkingVerdict === 'wrong') {
    // 答对但思路有问题：维持当前档（不升也不降）
    return currentInterval
  }

  // 快速模式（无思路验证）：答对升档
  const nextIdx = Math.min(currentIdx + 1, INTERVAL_SEQUENCE.length - 1)
  return INTERVAL_SEQUENCE[nextIdx]
}

// ===== 3. 升降级矩阵结果（§6.1）=====
export function getResultMatrix(
  record: Pick<ReviewRecord, 'isCorrect' | 'thinkingVerdict' | 'isSlowCorrect'>
): string {
  if (!record.isCorrect) return '4'                           // 降级
  if (record.thinkingVerdict === 'correct' && !record.isSlowCorrect) return '1'  // 升级
  if (record.thinkingVerdict === 'partial') return '2'        // 维持（思路partial）
  if (record.thinkingVerdict === 'wrong')   return '3'        // 维持（思路wrong）
  if (record.isSlowCorrect)                 return '2'        // 慢正确，视为维持
  return '1'                                                  // 快速模式答对，升级
}

// ===== 4. decayRatePerDay 更新（§6.3a）=====
export function updateDecayRate(
  userError: Pick<UserError, 'masteryHistory' | 'decayRatePerDay' | 'reviewInterval' | 'lastReviewedAt'>,
  newMastery: number
): number {
  const history: number[] = JSON.parse(userError.masteryHistory ?? '[]')
  if (history.length < 2) return userError.decayRatePerDay  // 历史不足，暂不更新

  const prevMastery = history[history.length - 1]
  const masteryDrop = prevMastery - newMastery

  const daysBetween = userError.lastReviewedAt
    ? differenceInDays(new Date(), new Date(userError.lastReviewedAt))
    : userError.reviewInterval

  if (masteryDrop <= 0 || daysBetween <= 0) return 0.0

  return Math.max(0, masteryDrop / daysBetween)
}

// ===== 5. stabilityScore 更新（§6.3b）=====
export function updateStabilityScore(masteryHistory: number[]): number {
  const recent = masteryHistory.slice(-3)
  if (recent.length < 2) return 50.0  // 历史不足，默认中等稳定

  const mean = recent.reduce((a, b) => a + b, 0) / recent.length
  const variance = recent.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / recent.length

  return variance === 0 ? 100.0 : 1 / variance
}

// ===== 6. isStockified 判定（§6.3c）=====
export function checkStockified(
  userError: Pick<UserError, 'masteryPercent' | 'masteryHistory' | 'isLastSlowCorrect'>
): boolean {
  if (userError.masteryPercent < 80) return false
  if (userError.isLastSlowCorrect)   return false

  const history: number[] = JSON.parse(userError.masteryHistory ?? '[]')
  if (history.length < 3) return false  // 需至少3条才能验证2次变化

  const [p2, p1, curr] = history.slice(-3)
  const drop1 = p2 - p1
  const drop2 = p1 - curr
  if (drop1 > 10 || drop2 > 10) return false

  return true
}

// ===== 7. isHot 判定（§6.1）=====
export function checkIsHot(recentResults: Array<{
  isCorrect: boolean
  thinkingVerdict: string | null
  isSlowCorrect: boolean
}>): boolean {
  if (recentResults.length < 2) return false

  const last2 = recentResults.slice(-2)

  // 连续2次答错
  if (last2.every(r => !r.isCorrect)) return true

  // 连续2次思路 wrong 或 partial
  if (last2.every(r => r.thinkingVerdict === 'wrong' || r.thinkingVerdict === 'partial')) return true

  // 连续3次慢正确
  if (recentResults.length >= 3) {
    const last3 = recentResults.slice(-3)
    if (last3.every(r => r.isSlowCorrect)) return true
  }

  return false
}

// ===== 8. errorROI 计算（§0.3）=====
export function calcErrorROI(params: {
  masteryPercent: number
  isOverdue: boolean           // nextReviewAt < now()
  isHot: boolean
  scoreWeight: number          // 该题型满分分值
  skillFrequencyWeight: number // 历年真题出现率加权（默认1.0）
  daysToExam: number | null
}): number {
  const { masteryPercent, isOverdue, isHot, scoreWeight, skillFrequencyWeight, daysToExam } = params

  // stockifyProb：存量化概率
  let stockifyProb: number
  if (masteryPercent >= 60)      stockifyProb = 0.8
  else if (masteryPercent >= 30) stockifyProb = 0.4
  else                           stockifyProb = 0.1

  if (isOverdue) stockifyProb *= 1.3  // 已到复习窗口，当日性价比更高
  if (isHot)     stockifyProb *= 0.7  // 连续答错，先让AI重新诊断

  // stockifyValue：存量化价值
  const stockifyValue = scoreWeight * (skillFrequencyWeight ?? 1.0)

  // timeViability：时间可行性
  let timeViability = 1.0
  if (daysToExam !== null) {
    if (daysToExam > 60) {
      timeViability = 1.0
    } else if (daysToExam >= 30) {
      timeViability = masteryPercent > 30 ? 1.0 : 0.2
    } else if (daysToExam >= 14) {
      timeViability = masteryPercent > 50 ? 1.0 : 0.1
    } else {
      timeViability = masteryPercent > 70 ? 1.0 : 0.0
    }
  }

  return stockifyProb * stockifyValue * timeViability
}

// ===== 9. 四状态机判定（§0.6）=====
export type QuestionState = 'stockified' | 'increment_candidate' | 'building' | 'skipped'

export function getQuestionState(params: {
  masteryPercent: number
  isStockified: boolean
  daysToExam: number | null
}): QuestionState {
  const { masteryPercent, isStockified, daysToExam } = params

  if (isStockified && masteryPercent >= 80) return 'stockified'
  if (masteryPercent >= 60)                 return 'increment_candidate'
  if (masteryPercent >= 30)                 return 'building'
  if (daysToExam !== null && daysToExam < 30) return 'skipped'
  return 'building'
}

export const STATE_LABELS: Record<QuestionState, string> = {
  stockified:          '✅ 已稳固',
  increment_candidate: '🔥 冲刺目标',
  building:            '🔨 攻坚中',
  skipped:             '⏸ 本次跳过',
}

// ===== 10. 完整答题后更新流程（调用顺序严格，§6.3 注释）=====
export function computePostAnswerUpdates(
  userError: UserError,
  record: Pick<ReviewRecord, 'isCorrect' | 'thinkingVerdict' | 'isSlowCorrect'>
): {
  masteryPercent: number
  reviewInterval: number
  nextReviewAt: Date
  masteryHistory: string
  stabilityScore: number
  decayRatePerDay: number
  isStockified: boolean
  isLastSlowCorrect: boolean
  lastReviewedAt: Date
  resultMatrix: string
} {
  // Step 1: 更新 mastery
  const newMastery = updateMastery(userError, record)

  // Step 2: 更新 interval
  const newInterval = updateInterval(userError.reviewInterval, record)

  // Step 3: push 到 masteryHistory（必须在 checkStockified 之前）
  const history: number[] = JSON.parse(userError.masteryHistory ?? '[]')
  history.push(newMastery)
  const newHistory = JSON.stringify(history)

  // Step 4: 计算 stabilityScore
  const newStability = updateStabilityScore(history)

  // Step 5: 计算 decayRate
  const newDecayRate = updateDecayRate(userError, newMastery)

  // Step 6: 判断 isStockified
  const newIsStockified = checkStockified({
    masteryPercent: newMastery,
    masteryHistory: newHistory,
    isLastSlowCorrect: record.isSlowCorrect,
  })

  // Step 7: nextReviewAt
  const nextReviewAt = addDays(new Date(), newInterval)

  return {
    masteryPercent:  newMastery,
    reviewInterval:  newInterval,
    nextReviewAt,
    masteryHistory:  newHistory,
    stabilityScore:  newStability,
    decayRatePerDay: newDecayRate,
    isStockified:    newIsStockified,
    isLastSlowCorrect: record.isSlowCorrect,
    lastReviewedAt:  new Date(),
    resultMatrix:    getResultMatrix(record),
  }
}
