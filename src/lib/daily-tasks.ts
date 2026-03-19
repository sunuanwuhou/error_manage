// lib/daily-tasks.ts
// ============================================================
// P0 核心引擎：每日推题队列生成（§0.3 §0.9）
// errorROI 排序 + 激活期切换
// ============================================================

import { prisma } from './prisma'
import { calcErrorROI, getQuestionState } from './mastery-engine'
import { differenceInDays } from 'date-fns'

interface DailyTaskStrategyInsight {
  totalTarget?: number
  activationTotalTarget?: number
  errorLimit?: number
  guardLimit?: number
  activationThresholdDays?: number
  activationQuestionTypes?: string[]
}

interface AppliedInsightMeta {
  id: string
  paramKey: string
  insightCategory: string
  updatedAt: Date
}

interface ActiveInsightSummary {
  title: string
  reason: string
  bullets: string[]
}

interface DailyTaskPlaybook {
  title: string
  reason: string
  steps: string[]
  nextStep: string
}

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

export async function getAppliedDailyTaskStrategy(userId: string): Promise<{
  strategy: DailyTaskStrategyInsight | null
  meta: AppliedInsightMeta | null
}> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string
    paramKey: string
    insightCategory: string
    paramValueNew: string
    updatedAt: Date
  }>>(`
    SELECT id, "paramKey", "insightCategory", "paramValueNew", "updatedAt"
    FROM system_insights
    WHERE status = 'applied'
      AND "paramKey" = 'daily_task_strategy'
      AND ("userId" = $1 OR "userId" IS NULL)
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
    ORDER BY
      CASE WHEN "userId" = $1 THEN 0 ELSE 1 END,
      COALESCE("appliedAt", "createdAt") DESC,
      "createdAt" DESC
    LIMIT 1
  `, userId)

  const insight = rows[0]

  if (!insight) {
    return { strategy: null, meta: null }
  }

  try {
    return {
      strategy: JSON.parse(insight.paramValueNew) as DailyTaskStrategyInsight,
      meta: {
        id: insight.id,
        paramKey: insight.paramKey,
        insightCategory: insight.insightCategory,
        updatedAt: insight.updatedAt,
      },
    }
  } catch {
    return { strategy: null, meta: null }
  }
}

export function buildActiveInsightSummary(
  strategy: DailyTaskStrategyInsight | null,
  isActivationMode: boolean,
  totalTarget: number,
  errorLimit: number,
  guardLimit: number,
  activationThresholdDays: number
): ActiveInsightSummary | null {
  if (!strategy) return null

  const bullets: string[] = [
    `今日目标 ${totalTarget} 道`,
    `错题上限 ${errorLimit} 道`,
    `守卫复习 ${guardLimit} 道`,
  ]

  if (isActivationMode) {
    bullets.push(`冲刺阈值 ${activationThresholdDays} 天`)
    if (strategy.activationQuestionTypes?.length) {
      bullets.push(`激活题型：${strategy.activationQuestionTypes.join('、')}`)
    }
  }

  return {
    title: '当前训练策略已应用',
    reason: isActivationMode
      ? '系统正在按已生效的冲刺策略排题，优先帮助你在考前激活可得分题。'
      : '系统正在按已生效的日任务策略排题，优先平衡稳固底线和增量推进。',
    bullets,
  }
}

function buildDailyTaskPlaybook(
  strategy: DailyTaskStrategyInsight | null,
  isActivationMode: boolean,
  totalTarget: number,
  errorLimit: number,
  guardLimit: number
): DailyTaskPlaybook {
  if (isActivationMode) {
    return {
      title: '先激活，再补位',
      reason: '考前优先唤醒 60-80% 的可得分题，再用真题补齐今日训练量，避免把时间平均摊薄。',
      steps: [
        `先做激活题，优先处理 ${errorLimit} 道以内的可得分题`,
        `再看同类增量题，巩固刚被唤醒的题感`,
        `最后用真题补位，把今日 ${totalTarget} 道目标做满`,
      ],
      nextStep: '做完后先回看最弱题型的总结，再决定下一轮继续激活还是转回整卷训练。',
    }
  }

  const activationTypes = strategy?.activationQuestionTypes?.length
    ? `，重点留意 ${strategy.activationQuestionTypes.join('、')}`
    : ''

  return {
    title: '先保底，再补位',
    reason: `系统先稳住今天到期的错题和守卫复习，再用真题补满训练量${activationTypes}。`,
    steps: [
      `先做错题复盘，优先清掉今天到期且高 ROI 的题`,
      `再做守卫复习，最多 ${guardLimit} 道，保证已稳固内容不掉线`,
      `最后做真题补位，用剩余题目补满今日 ${totalTarget} 道目标`,
    ],
    nextStep: '做完今天任务后，先看最弱题型的总结，再决定明天补哪一类。',
  }
}

export async function getDailyTaskStrategySnapshot(userId: string, params: {
  examType: string
  examDate: Date | null
  dailyGoal: number
}): Promise<{
  strategy: DailyTaskStrategyInsight | null
  activeInsight: AppliedInsightMeta | null
  activeInsightSummary: ActiveInsightSummary | null
  mode: 'building' | 'activation'
  totalTarget: number
  errorLimit: number
  guardLimit: number
  activationThresholdDays: number
  playbook: DailyTaskPlaybook
}> {
  const { strategy, meta: activeInsight } = await getAppliedDailyTaskStrategy(userId)
  const daysToExam = params.examDate
    ? differenceInDays(new Date(params.examDate), new Date())
    : null

  const activationThresholdDays = strategy?.activationThresholdDays ?? 14
  const isActivationMode = daysToExam !== null && daysToExam <= activationThresholdDays
  const totalTarget = isActivationMode
    ? strategy?.activationTotalTarget ?? 50
    : strategy?.totalTarget ?? params.dailyGoal
  const errorLimit = strategy?.errorLimit ?? 30
  const guardLimit = strategy?.guardLimit ?? 10

  return {
    strategy,
    activeInsight,
    activeInsightSummary: buildActiveInsightSummary(
      strategy,
      isActivationMode,
      totalTarget,
      errorLimit,
      guardLimit,
      activationThresholdDays
    ),
    playbook: buildDailyTaskPlaybook(
      strategy,
      isActivationMode,
      totalTarget,
      errorLimit,
      guardLimit
    ),
    mode: isActivationMode ? 'activation' : 'building',
    totalTarget,
    errorLimit,
    guardLimit,
    activationThresholdDays,
  }
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
  guardCount: number
  totalTarget: number
  totalTargetConfig: number
  daysToExam: number | null
  activeInsight: AppliedInsightMeta | null
  activeInsightSummary: ActiveInsightSummary | null
  strategySnapshot: {
    activationThresholdDays: number
    errorLimit: number
    guardLimit: number
    totalTarget: number
    mode: 'building' | 'activation'
    playbook: DailyTaskPlaybook
  }
}> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { examDate: true, dailyGoal: true, examType: true },
  })
  const daysToExam = user.examDate
    ? differenceInDays(new Date(user.examDate), new Date())
    : null

  const snapshot = await getDailyTaskStrategySnapshot(userId, {
    examType: user.examType,
    examDate: user.examDate,
    dailyGoal: user.dailyGoal,
  })
  const { strategy, activeInsight, activeInsightSummary, mode: queueMode, totalTarget, errorLimit, guardLimit, activationThresholdDays } = snapshot

  // 守卫队列：最多10道已存量化题（不占主要名额）
  const guardErrors = await buildGuardQueue(userId, guardLimit)

  const reviewErrors = queueMode === 'activation'
    ? await buildActivationQueue(userId, errorLimit, strategy?.activationQuestionTypes)
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
    mode: queueMode,
    reviewErrors:      allReviewErrors,
    guardCount:        guardErrors.length,
    practiceQuestions,
    totalTarget:       actualTotal,
    totalTargetConfig: totalTarget,
    daysToExam,
    activeInsight,
    activeInsightSummary,
    strategySnapshot: {
      activationThresholdDays,
      errorLimit,
      guardLimit,
      totalTarget,
      mode: queueMode,
      playbook: buildDailyTaskPlaybook(
        strategy,
        queueMode === 'activation',
        totalTarget,
        errorLimit,
        guardLimit
      ),
    },
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
  limit: number,
  activationQuestionTypes?: string[]
): Promise<DailyErrorItem[]> {
  const allowedQuestionTypes = activationQuestionTypes?.length
    ? activationQuestionTypes
    : ['判断推理', '言语理解', '资料分析']

  const errors = await prisma.userError.findMany({
    where: {
      userId,
      masteryPercent: { gte: 60, lte: 80 },
      decayRatePerDay: { lt: 0.05 },
      question: {
        type: { in: allowedQuestionTypes },
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
