// src/lib/activity/logger.ts
// ============================================================
// 统一活动记录入口
// 所有关键操作都通过这里记录，作为 AI 分析的原始素材
// 设计原则：
//   1. 非阻塞 — 记录失败不影响主流程
//   2. 富上下文 — 保留所有有分析价值的字段
//   3. 可查询 — 索引设计支持分析服务的典型查询
// ============================================================

import { prisma } from '../prisma'

// ── 事件类型定义 ──────────────────────────────────────────────────
export const EVENT_TYPES = {
  // 练习行为
  PRACTICE_ANSWER:       'practice.answer',       // 答了一道题
  PRACTICE_SKIP:         'practice.skip',          // 跳过题目
  PRACTICE_SESSION_START:'practice.session_start', // 开始练习
  PRACTICE_SESSION_END:  'practice.session_end',   // 结束练习（含汇总）
  PRACTICE_MODE_CHANGE:  'practice.mode_change',   // 切换快速/深度模式

  // 错题生命周期
  ERROR_CREATED:         'error.created',          // 新录入错题
  ERROR_STOCKIFIED:      'error.stockified',        // 题目存量化
  ERROR_REBOUND:         'error.rebound',           // 掌握度反弹
  ERROR_HOT_MARKED:      'error.hot_marked',        // 标记为🔥易错
  ERROR_PRE_STOCKIFIED:  'error.pre_stockified',    // 预稳固🌱

  // 导入操作
  IMPORT_STARTED:        'import.started',
  IMPORT_COMPLETED:      'import.completed',        // 导入完成
  IMPORT_SCREENSHOT:     'import.screenshot',       // 截图识别

  // AI 操作
  AI_DIAGNOSIS_DONE:     'ai.diagnosis_done',       // 首次诊断完成
  AI_THINKING_VERIFIED:  'ai.thinking_verified',    // 思路验证结果
  AI_KNOWLEDGE_ADDED:    'ai.knowledge_added',      // 好题加入知识库
  AI_ANALYSIS_DONE:      'ai.analysis_done',        // 分析服务完成

  // 系统行为
  SYSTEM_QUEUE_ADDED:    'system.queue_added',      // 分析队列新增
  SYSTEM_STRATEGY_SHIFT: 'system.strategy_shift',  // 策略切换
  SYSTEM_INSIGHT_APPLIED:'system.insight_applied', // 系统建议被采纳
  SYSTEM_INTERVAL_ADJ:   'system.interval_adjusted',// 间隔被个性化调整

  // 用户操作
  USER_ONBOARDING:       'user.onboarding',        // 完成向导
  USER_SETTINGS_CHANGED: 'user.settings_changed',  // 修改设置
  USER_NOTE_CREATED:     'user.note_created',      // 记笔记
  USER_INSIGHT_CREATED:  'user.insight_created',   // 固化规律
} as const

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES]

// ── Payload 类型（各事件的专属字段）────────────────────────────────
interface PracticeAnswerPayload {
  questionId:      string
  questionType:    string
  questionSubtype?: string
  masteryBefore:   number
  masteryAfter:    number
  isCorrect:       boolean
  timeSpent?:      number
  isSlowCorrect:   boolean
  thinkingVerdict?: string       // correct/partial/wrong
  resultMatrix:    string        // 1/2/3/4
  daysToExam?:     number
  practiceMode:    string        // quick/deep/focused/timed
  reviewInterval:  number
}

interface ErrorStockifiedPayload {
  questionId:      string
  questionType:    string
  masteryPercent:  number
  reviewCount:     number
  daysToAchieve:   number        // 从录入到存量化花了几天
  daysToExam?:     number
}

interface ImportCompletedPayload {
  filename:        string
  examType:        string
  totalQuestions:  number
  newQuestions:    number        // 新入库数
  skipped:         number        // 已存在跳过数
  skillTagsFound:  string[]      // 发现的考点列表
  analysisTasksCreated: number   // 触发了多少分析任务
}

interface AIAnalysisDonePayload {
  analysisType:    string
  snapshotId:      string
  findingsCount:   number
  recommendationsCount: number
  dataPointsUsed:  number
  confidenceScore: number
}

interface SessionEndPayload {
  sessionId:       string
  totalQuestions:  number
  correctCount:    number
  accuracy:        number
  stockifiedCount: number        // 本次新存量化
  slowCorrectCount: number
  durationMinutes: number
  daysToExam?:     number
}

// ── 核心记录函数 ──────────────────────────────────────────────────

export async function log(params: {
  userId?:     string
  eventType:   EventType
  entityType?: string
  entityId?:   string
  payload:     Record<string, any>
  sessionId?:  string
  userAgent?:  string
}): Promise<void> {
  // 非阻塞：记录失败不影响主流程
  prisma.activityLog.create({
    data: {
      userId:     params.userId ?? null,
      eventType:  params.eventType,
      entityType: params.entityType ?? null,
      entityId:   params.entityId ?? null,
      payload:    JSON.stringify(params.payload),
      sessionId:  params.sessionId ?? null,
      deviceHint: params.userAgent
        ? (params.userAgent.includes('Mobile') ? 'mobile' : 'desktop')
        : null,
      hourOfDay:  new Date().getHours(),
    },
  }).catch(err => {
    // 静默失败，记录到 console 但不抛出
    console.error('[ActivityLog] 记录失败（不影响主流程）：', err.message)
  })
}

// ── 便捷函数（类型安全的快捷方式）────────────────────────────────

export async function logPracticeAnswer(
  userId: string,
  payload: PracticeAnswerPayload,
  sessionId?: string
) {
  return log({
    userId, sessionId,
    eventType:  EVENT_TYPES.PRACTICE_ANSWER,
    entityType: 'question',
    entityId:   payload.questionId,
    payload,
  })
}

export async function logErrorStockified(
  userId: string,
  payload: ErrorStockifiedPayload
) {
  return log({
    userId,
    eventType:  EVENT_TYPES.ERROR_STOCKIFIED,
    entityType: 'userError',
    entityId:   payload.questionId,
    payload,
  })
}

export async function logImportCompleted(
  userId: string,
  payload: ImportCompletedPayload
) {
  return log({
    userId,
    eventType:  EVENT_TYPES.IMPORT_COMPLETED,
    entityType: 'import',
    payload,
  })
}

export async function logAIAnalysisDone(
  userId: string | null,
  payload: AIAnalysisDonePayload
) {
  return log({
    userId: userId ?? undefined,
    eventType:  EVENT_TYPES.AI_ANALYSIS_DONE,
    entityType: 'analysisSnapshot',
    entityId:   payload.snapshotId,
    payload,
  })
}

export async function logSessionEnd(
  userId: string,
  payload: SessionEndPayload
) {
  return log({
    userId,
    eventType:  EVENT_TYPES.PRACTICE_SESSION_END,
    entityType: 'session',
    entityId:   payload.sessionId,
    payload,
  })
}

// ── 分析服务专用：批量查询 ActivityLog ───────────────────────────

export async function getRecentActivity(params: {
  userId:     string
  eventTypes?: EventType[]
  since?:     Date
  limit?:     number
}): Promise<Array<{
  eventType:  string
  payload:    Record<string, any>
  hourOfDay:  number | null
  createdAt:  Date
}>> {
  const rows = await prisma.activityLog.findMany({
    where: {
      userId:    params.userId,
      eventType: params.eventTypes ? { in: params.eventTypes } : undefined,
      createdAt: params.since ? { gte: params.since } : undefined,
    },
    orderBy: { createdAt: 'desc' },
    take: params.limit ?? 200,
    select: {
      eventType: true,
      payload:   true,
      hourOfDay: true,
      createdAt: true,
    },
  })

  return rows.map(r => ({
    eventType: r.eventType,
    payload:   JSON.parse(r.payload),
    hourOfDay: r.hourOfDay,
    createdAt: r.createdAt,
  }))
}

// ── 统计摘要（供 AI 分析服务构建 prompt）────────────────────────

export async function buildActivitySummary(userId: string, days = 30): Promise<{
  totalEvents:      number
  practiceEvents:   number
  accuracy:         number
  stockifiedCount:  number
  reboundCount:     number
  hotHours:         number[]      // 答题最集中的小时
  weakTypes:        string[]      // 错误率最高的题型
  importedCount:    number
  aiDiagnosisCount: number
}> {
  const since = new Date(Date.now() - days * 86400000)

  const logs = await prisma.activityLog.findMany({
    where:   { userId, createdAt: { gte: since } },
    select:  { eventType: true, payload: true, hourOfDay: true },
  })

  const practiceAnswers = logs
    .filter(l => l.eventType === EVENT_TYPES.PRACTICE_ANSWER)
    .map(l => JSON.parse(l.payload) as PracticeAnswerPayload)

  const correct   = practiceAnswers.filter(p => p.isCorrect).length
  const accuracy  = practiceAnswers.length > 0
    ? Math.round((correct / practiceAnswers.length) * 100) : 0

  // 高频小时
  const hourCounts: Record<number, number> = {}
  logs.forEach(l => {
    if (l.hourOfDay != null) hourCounts[l.hourOfDay] = (hourCounts[l.hourOfDay] ?? 0) + 1
  })
  const hotHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => Number(h))

  // 薄弱题型
  const typeErrors: Record<string, { correct: number; total: number }> = {}
  practiceAnswers.forEach(p => {
    if (!typeErrors[p.questionType]) typeErrors[p.questionType] = { correct: 0, total: 0 }
    typeErrors[p.questionType].total++
    if (p.isCorrect) typeErrors[p.questionType].correct++
  })
  const weakTypes = Object.entries(typeErrors)
    .filter(([, v]) => v.total >= 5)
    .map(([t, v]) => ({ type: t, accuracy: v.correct / v.total }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3)
    .map(t => t.type)

  return {
    totalEvents:      logs.length,
    practiceEvents:   practiceAnswers.length,
    accuracy,
    stockifiedCount:  logs.filter(l => l.eventType === EVENT_TYPES.ERROR_STOCKIFIED).length,
    reboundCount:     logs.filter(l => l.eventType === EVENT_TYPES.ERROR_REBOUND).length,
    hotHours,
    weakTypes,
    importedCount:    logs.filter(l => l.eventType === EVENT_TYPES.IMPORT_COMPLETED).length,
    aiDiagnosisCount: logs.filter(l => l.eventType === EVENT_TYPES.AI_DIAGNOSIS_DONE).length,
  }
}
