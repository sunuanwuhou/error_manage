// lib/daily-tasks.ts
// ============================================================
// P0 核心引擎：每日推题队列生成（§0.3 §0.9）
// errorROI 排序 + 激活期切换
// ============================================================

import { prisma } from './prisma'
import { calcErrorROI, getQuestionState } from './mastery-engine'
import { differenceInDays } from 'date-fns'

// 各题型分值权重（国考参考，§十八.2）
const SCORE_WEIGHTS: Record<string, Record<string, number>> = {
  guo_kao: {
    '资料分析': 20,
    '判断推理': 36,
    '言语理解': 32,
    '数量关系': 15,
    '常识判断': 12,
    '逻辑判断': 36,
    '图形推理': 36,
  },
  sheng_kao: {
    '资料分析': 20,
    '判断推理': 30,
    '言语理解': 30,
    '数量关系': 0,   // 省考多数省份无数量关系
    '常识判断': 20,
  },
  tong_kao: {
    '资料分析': 20,
    '判断推理': 30,
    '言语理解': 30,
    '数量关系': 10,
    '常识判断': 10,
  },
}

export function getWeights(examType: string): Record<string, number> {
  return SCORE_WEIGHTS[examType] ?? SCORE_WEIGHTS['guo_kao']
}

// ============================================================
// A3: 守卫队列 — 已存量化题30天复习一次（§0.1）
// 答对且非isSlowCorrect → 延至60天；答错 → 立即降回增量候选（在submit API处理）
// ============================================================
async function buildGuardQueue(userId: string, limit: number): Promise<DailyErrorItem[]> {
  const errors = await prisma.userError.findMany({
    where: {
      userId,
      isStockified: true,
      nextReviewAt: { lte: new Date() },
    },
    include: { question: { select: { id: true, type: true } } },
    orderBy: { stabilityScore: 'asc' },  // 最不稳定的优先
    take: limit,
  })
  return errors.map(e => ({
    userErrorId:   e.id,
    questionId:    e.questionId,
    masteryPercent: e.masteryPercent,
    state:         'stockified' as const,
    errorROI:      0.5,
    isOverdue:     true,
    isHot:         false,
    questionType:  e.question.type,
  }))
}

// ============================================================
// 主函数：生成今日推题队列
// ============================================================
export async function buildDailyQueue(userId: string): Promise<{
  mode: 'building' | 'activation'  // 建设期 or 激活期
  reviewErrors: DailyErrorItem[]    // 错题复盘（P0：今日到期优先）
  practiceQuestions: string[]       // 真题补位（Question IDs）
  totalTarget: number
  daysToExam: number | null
}> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { examDate: true, dailyGoal: true, examType: true },
  })

  const daysToExam = user.examDate
    ? differenceInDays(new Date(user.examDate), new Date())
    : null

  const isActivationMode = daysToExam !== null && daysToExam <= 14
  const totalTarget = isActivationMode ? 50 : user.dailyGoal
  const errorLimit = 30  // 错题单日上限（默认30，§0.9）

  // 守卫队列：最多10道已存量化题（不占主要名额）
  const guardErrors = await buildGuardQueue(userId, 10)

  const reviewErrors = isActivationMode
    ? await buildActivationQueue(userId, errorLimit)
    : await buildBuildingQueue(userId, errorLimit - guardErrors.length, daysToExam, user.examType)

  // 守卫队列追加到错题复盘末尾
  const allReviewErrors = [...reviewErrors, ...guardErrors]

  // 真题补位：剩余名额用真题填满
  const remaining = Math.max(0, totalTarget - reviewErrors.length)
  const practiceQuestions = remaining > 0
    ? await buildPracticeQueue(userId, user.examType, remaining)
    : []

  // F6: totalTarget 以实际能推出的题数为准，避免"50/70"的困惑
  const actualTotal = allReviewErrors.length + practiceQuestions.length

  return {
    mode: isActivationMode ? 'activation' : 'building',
    reviewErrors:      allReviewErrors,
    guardCount:        guardErrors.length,
    practiceQuestions,
    totalTarget:       actualTotal,
    totalTargetConfig: totalTarget,
    daysToExam,
  }
}

// ============================================================
// 建设期队列：errorROI 排序（§0.3）
// ============================================================
export interface DailyErrorItem {
  userErrorId: string
  questionId: string
  masteryPercent: number
  state: ReturnType<typeof getQuestionState>
  errorROI: number
  isOverdue: boolean
  isHot: boolean
  questionType: string
}

async function buildBuildingQueue(
  userId: string,
  limit: number,
  daysToExam: number | null,
  examType: string
): Promise<DailyErrorItem[]> {
  const weights = getWeights(examType)

  const errors = await prisma.userError.findMany({
    where: {
      userId,
      isStockified: false,
      nextReviewAt: { lte: new Date() },  // 今日到期
    },
    include: {
      question: {
        select: { id: true, type: true, subtype: true },
      },
    },
    orderBy: { nextReviewAt: 'asc' },
  })

  const items: DailyErrorItem[] = errors.map(e => {
    const scoreWeight = weights[e.question.type] ?? 10
    const roi = calcErrorROI({
      masteryPercent: e.masteryPercent,
      isOverdue: e.nextReviewAt < new Date(),
      isHot: e.isHot,
      scoreWeight,
      skillFrequencyWeight: 1.0,  // Phase 2 接入 ExamTopicStats
      daysToExam,
    })

    return {
      userErrorId: e.id,
      questionId: e.questionId,
      masteryPercent: e.masteryPercent,
      state: getQuestionState({ masteryPercent: e.masteryPercent, isStockified: e.isStockified, daysToExam }),
      errorROI: roi,
      isOverdue: e.nextReviewAt < new Date(),
      isHot: e.isHot,
      questionType: e.question.type,
    }
  })

  // 按 errorROI 降序，超出上限按 ROI 截断
  return items
    .sort((a, b) => b.errorROI - a.errorROI)
    .slice(0, limit)
}

// ============================================================
// 激活期队列：mastery 60-80%，遗忘平缓，识别类题型（§0.5）
// ============================================================
async function buildActivationQueue(
  userId: string,
  limit: number
): Promise<DailyErrorItem[]> {
  const errors = await prisma.userError.findMany({
    where: {
      userId,
      masteryPercent: { gte: 60, lte: 80 },
      decayRatePerDay: { lt: 0.05 },
      question: {
        type: { in: ['判断推理', '言语理解', '资料分析'] },
      },
    },
    include: {
      question: { select: { id: true, type: true } },
    },
    orderBy: { masteryPercent: 'desc' },  // 最接近存量化门槛的优先
    take: limit,
  })

  return errors.map(e => ({
    userErrorId: e.id,
    questionId: e.questionId,
    masteryPercent: e.masteryPercent,
    state: 'increment_candidate' as const,
    errorROI: e.masteryPercent / 100,  // 激活期简化，直接用 mastery 排序
    isOverdue: false,
    isHot: e.isHot,
    questionType: e.question.type,
  }))
}

// ============================================================
// 真题补位队列（冷启动 + 剩余名额）（§0.8）
// ============================================================
async function buildPracticeQueue(
  userId: string,
  examType: string,
  limit: number
): Promise<string[]> {
  // Fix 2: 优先取待练池（导入后 isPending=true）
  const pending = await prisma.practiceRecord.findMany({
    where:   { userId, isPending: true },
    orderBy: { createdAt: 'asc' },
    take:    limit,
    select:  { questionId: true },
  })
  if (pending.length >= limit) {
    return pending.map(p => p.questionId)
  }

  // 待练池不足，从题库补充未练过的题
  const alreadyHave = new Set(pending.map(p => p.questionId))
  const remaining   = limit - pending.length

  const questions = await prisma.question.findMany({
    where: {
      isPublic: true,
      examType: { in: [examType, 'common'] },
      NOT: {
        OR: [
          { userErrors:       { some: { userId } } },
          { practiceRecords:  { some: { userId, nextShowAt: { gt: new Date() } } } },
        ],
      },
    },
    select:  { id: true },
    orderBy: { createdAt: 'asc' },
    take:    remaining * 2,  // 多取一些，过滤 alreadyHave
  })

  const extra = questions.map(q => q.id).filter(id => !alreadyHave.has(id)).slice(0, remaining)
  return [...pending.map(p => p.questionId), ...extra]
}

// ============================================================
// A3: 守卫队列 — 已存量化的题30天复习一次（§0.1）
// 答对且非isSlowCorrect → 间隔延至60天；答错 → 降回增量候选
// ============================================================
export async function buildGuardQueue(userId: string): Promise<DailyErrorItem[]> {
  const guardErrors = await prisma.userError.findMany({
    where: {
      userId,
      isStockified: true,
      nextReviewAt: { lte: new Date() },
    },
    include: { question: { select: { id: true, type: true } } },
    orderBy: { stabilityScore: 'asc' },  // 稳定性最低的优先复习
    take: 10,  // 守卫队列每日最多10题，不占用太多名额
  })

  return guardErrors.map(e => ({
    userErrorId:   e.id,
    questionId:    e.questionId,
    masteryPercent: e.masteryPercent,
    state:         'stockified' as const,
    errorROI:      999,  // 守卫队列最高优先级
    isOverdue:     e.nextReviewAt < new Date(),
    isHot:         e.isHot,
    questionType:  e.question.type,
  }))
}
