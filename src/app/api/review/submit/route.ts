// src/app/api/review/submit/route.ts — 完整版（含 A1/A2/A3/A4/A7 修复）

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computePostAnswerUpdates, checkIsHot } from '@/lib/mastery-engine'
import { logPracticeAnswer, logErrorStockified } from '@/lib/activity/logger'
import { attachErrorToKnowledgeNote } from '@/lib/knowledge-notes'
import { z } from 'zod'

const submitSchema = z.object({
  userErrorId:       z.string().optional(),   // 错题模式
  questionId:        z.string().optional(),   // F2: 真题模式，答错时自动创建 UserError
  source:            z.enum(['error', 'practice']).default('error'),
  isCorrect:         z.boolean(),
  timeSpent:         z.number().optional(),
  thinkingVerdict:   z.enum(['correct', 'partial', 'wrong']).nullable().optional(),
  thinkingFeedback:  z.string().optional(),
  userThinkingText:  z.string().optional(),
  userThinkingImage: z.string().optional(),
  isSlowCorrect:     z.boolean().default(false),
  thinkingInputType: z.enum(['text', 'sketch']).nullable().optional(),
  practiceMode:      z.enum(['quick', 'deep', 'focused', 'timed']).default('quick'),
  selectedAnswer:    z.string().optional(),
  sessionId:         z.string().optional(),
  paperSessionId:    z.string().optional(),
  paperQuestionIndex: z.number().int().nonnegative().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = submitSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const data = parsed.data
  if (data.source === 'practice') {
    return handlePracticeSubmit(userId, data)
  }

  const userError = await prisma.userError.findFirst({
    where: { id: data.userErrorId, userId },
    include: { question: { select: { id: true, type: true, subtype: true, sub2: true, skillTags: true, content: true } } },
  })
  if (!userError) return NextResponse.json({ error: '题目不存在' }, { status: 404 })

  // 核心引擎：计算更新值
  const updates = computePostAnswerUpdates(userError, {
    isCorrect:       data.isCorrect,
    thinkingVerdict: data.thinkingVerdict ?? null,
    isSlowCorrect:   data.isSlowCorrect,
  })

  // A1: reboundAlert 计算 — mastery 比历史最高低 20%+
  const history: number[] = JSON.parse(userError.masteryHistory ?? '[]')
  const historicalMax = history.length > 0 ? Math.max(...history) : userError.masteryPercent
  const newReboundAlert = updates.masteryPercent < historicalMax - 20

  // A2: isHot 计算 — 需要最近3条 ReviewRecord
  const recentRecords = await prisma.reviewRecord.findMany({
    where:   { userErrorId: data.userErrorId },
    orderBy: { createdAt: 'desc' },
    take:    3,
    select:  { isCorrect: true, thinkingVerdict: true, isSlowCorrect: true },
  })
  // 加上本次记录
  const allRecent = [
    { isCorrect: data.isCorrect, thinkingVerdict: data.thinkingVerdict ?? null, isSlowCorrect: data.isSlowCorrect },
    ...recentRecords,
  ]
  const newIsHot = checkIsHot(allRecent)

  // A4: 预存量化里程碑检测
  const newHistory: number[] = JSON.parse(updates.masteryHistory)
  let preStockified = false
  if (updates.masteryPercent >= 60 && !updates.isStockified && newHistory.length >= 3) {
    const [p2, p1, curr] = newHistory.slice(-3)
    preStockified = (p1 >= p2 || p2 - p1 <= 5) && (curr >= p1 || p1 - curr <= 5)
  }

  // F3: 守卫队列覆盖逻辑 — 合并到事务里，避免两次 update 冲突
  const guardOverrides: any = {}
  if (userError.isStockified) {
    if (!data.isCorrect) {
      // 存量化题答错 → 降回增量候选
      guardOverrides.isStockified  = false
      guardOverrides.reboundAlert  = true
      guardOverrides.reviewInterval = 1
      guardOverrides.nextReviewAt  = new Date(Date.now() + 86400000)
    } else if (!data.isSlowCorrect) {
      // 存量化题答对且不慢 → 延至60天
      guardOverrides.reviewInterval = 30
      guardOverrides.nextReviewAt  = new Date(Date.now() + 60 * 86400000)
    }
  }

  // F5: reboundAlert 清除 — 答对且 mastery 回升时自动清除
  if (data.isCorrect && userError.reboundAlert && !guardOverrides.reboundAlert) {
    const histMax = newHistory.length > 1 ? Math.max(...newHistory.slice(0, -1)) : 0
    if (updates.masteryPercent >= histMax - 10) {
      guardOverrides.reboundAlert = false
    }
  }

  // ── 单次事务（守卫逻辑 + 引擎结果合并）──────────────────────
  await prisma.$transaction([
    prisma.reviewRecord.create({
      data: {
        userId,
        userErrorId:       data.userErrorId!,
        isCorrect:         data.isCorrect,
        timeSpent:         data.timeSpent,
        isSlowCorrect:     data.isSlowCorrect,
        thinkingInputType: data.thinkingInputType ?? null,
        userThinkingText:  data.userThinkingText,
        userThinkingImage: data.userThinkingImage,
        thinkingVerdict:   data.thinkingVerdict ?? null,
        thinkingFeedback:  data.thinkingFeedback,
        resultMatrix:      updates.resultMatrix,
        questionSource:    'real',
      },
    }),
    prisma.userError.update({
      where: { id: data.userErrorId! },
      data: {
        masteryPercent:    updates.masteryPercent,
        reviewInterval:    updates.reviewInterval,
        nextReviewAt:      updates.nextReviewAt,
        masteryHistory:    updates.masteryHistory,
        stabilityScore:    updates.stabilityScore,
        decayRatePerDay:   updates.decayRatePerDay,
        isStockified:      updates.isStockified,
        isLastSlowCorrect: updates.isLastSlowCorrect,
        lastReviewedAt:    updates.lastReviewedAt,
        isHot:             newIsHot,
        reboundAlert:      newReboundAlert,
        reviewCount:       { increment: 1 },
        correctCount:      data.isCorrect ? { increment: 1 } : undefined,
        ...guardOverrides,   // F3: 覆盖守卫逻辑（同一事务，无冲突）
      },
    }),
  ])

  // 异步任务（不阻塞响应）
  const asyncTasks: Promise<any>[] = []
  const stockifiedUserErrorId = data.userErrorId

  // 首次存量化 → 记忆锚点
  if (updates.isStockified && !userError.isStockified && stockifiedUserErrorId) {
    asyncTasks.push(
      import('@/lib/memory-anchor').then(({ generateMemoryAnchor }) =>
        generateMemoryAnchor(stockifiedUserErrorId)
      )
    )
  }

  // A7: 异步更新 UserSectionStats 预测分
  asyncTasks.push(updateSectionStats(userId))

  Promise.allSettled(asyncTasks).catch(() => {})

  if (!data.isCorrect) {
    attachErrorToKnowledgeNote({
      userId,
      userErrorId: data.userErrorId!,
      question: {
        type: userError.question.type,
        subtype: userError.question.subtype,
        sub2: userError.question.sub2,
        skillTags: userError.question.skillTags,
        content: userError.question.content,
      },
      knowledgeTitle: userError.aiReasonTag || userError.reasonTag || userError.aiRootReason || userError.errorReason || null,
      summary: userError.aiActionRule || userError.aiThinking || userError.errorReason || null,
    }).catch(() => {})
  }

  logPracticeAnswer(userId, {
    questionId:      userError.questionId,
    questionType:    userError.question.type,
    questionSubtype: userError.question.subtype ?? undefined,
    masteryBefore:   userError.masteryPercent,
    masteryAfter:    updates.masteryPercent,
    isCorrect:       data.isCorrect,
    timeSpent:       data.timeSpent,
    isSlowCorrect:   data.isSlowCorrect,
    thinkingVerdict: data.thinkingVerdict ?? undefined,
    resultMatrix:    updates.resultMatrix,
    practiceMode:    data.practiceMode,
    reviewInterval:  updates.reviewInterval,
  }, data.sessionId).catch(() => {})

  return NextResponse.json({
    success:          true,
    masteryPercent:   updates.masteryPercent,
    reviewInterval:   updates.reviewInterval,
    nextReviewAt:     updates.nextReviewAt,
    isStockified:     updates.isStockified,
    resultMatrix:     updates.resultMatrix,
    wasStockifiedNow: updates.isStockified && !userError.isStockified,
    isHot:            newIsHot,
    reboundAlert:     newReboundAlert,
    preStockified,    // A4: 预存量化里程碑
  })
}

// A7: 更新 UserSectionStats（每次答题后异步执行）
async function updateSectionStats(userId: string) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { examType: true, targetScore: true },
  })
  if (!user) return

  const { getWeights } = await import('@/lib/daily-tasks')
  const weights = getWeights(user.examType)

  const errors = await prisma.userError.findMany({
    where:   { userId },
    include: { question: { select: { type: true } } },
  })

  const AVG_SKILLS = 5
  let stockifiedScore = 0, incrementScore = 0
  const byType: Record<string, { correct: number; total: number; stockified: number }> = {}

  errors.forEach(e => {
    const t = e.question.type
    if (!byType[t]) byType[t] = { correct: 0, total: 0, stockified: 0 }
    byType[t].total++
    if (e.isStockified) byType[t].stockified++
    const w = weights[t] ?? 10
    const perSkill = w / AVG_SKILLS
    if (e.isStockified) stockifiedScore += perSkill
    else if (e.masteryPercent >= 60) incrementScore += perSkill * (e.masteryPercent / 100)
  })

  // 各题型答对率（从最近20条复习记录算）
  const recentByType: Record<string, { correct: number; total: number; timeSum: number }> = {}
  const records = await prisma.reviewRecord.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    take:    200,
    include: { userError: { include: { question: { select: { type: true } } } } },
  })
  records.forEach(r => {
    const t = r.userError.question.type
    if (!recentByType[t]) recentByType[t] = { correct: 0, total: 0, timeSum: 0 }
    recentByType[t].total++
    if (r.isCorrect) recentByType[t].correct++
    if (r.timeSpent) recentByType[t].timeSum += r.timeSpent
  })

  const statsJson: Record<string, any> = {}
  Object.entries(recentByType).forEach(([type, d]) => {
    statsJson[type] = {
      correct:     d.correct,
      total:       d.total,
      avgSeconds:  d.total > 0 ? Math.round(d.timeSum / d.total) : 0,
      scoreWeight: weights[type] ?? 0,
      target:      0.75,
    }
  })

  const predictedScore = Math.round(
    Object.entries(statsJson).reduce((sum, [type, d]) =>
      sum + (d.correct / Math.max(d.total, 1)) * (weights[type] ?? 0), 0)
  )

  await prisma.userSectionStats.upsert({
    where:  { userId },
    update: { statsJson: JSON.stringify(statsJson), predictedScore, updatedAt: new Date() },
    create: { userId, statsJson: JSON.stringify(statsJson), predictedScore, targetScore: user.targetScore },
  })
}


// 真题练习完成后，把 PracticeRecord.isPending 改为 false
// （这段逻辑在 review/submit 里异步处理，也可以放到 practiceRecord 专属 API）
async function markPracticeRecordDone(userId: string, questionId: string, isCorrect: boolean) {
  await prisma.practiceRecord.updateMany({
    where: { userId, questionId, isPending: true },
    data:  {
      isPending:  false,
      isCorrect,
      nextShowAt: isCorrect ? new Date(Date.now() + 7 * 86400000) : null,
    },
  })
}


// ── F2: 真题模式答题处理 ─────────────────────────────────────────
async function handlePracticeSubmit(
  userId: string,
  data: any
): Promise<Response> {
  const { questionId, isCorrect, timeSpent, isSlowCorrect } = data
  const { NextResponse } = await import('next/server')
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true, type: true, subtype: true, sub2: true, skillTags: true, content: true },
  })

  if (!question) {
    return NextResponse.json({ error: '题目不存在' }, { status: 404 })
  }

  // 标记 PracticeRecord 为已练
  await prisma.practiceRecord.updateMany({
    where: { userId, questionId, isPending: true },
    data:  {
      isPending:  false,
      isCorrect,
      nextShowAt: isCorrect ? new Date(Date.now() + 7 * 86400000) : null,
    },
  })

  if (data.paperSessionId) {
    const paperSessionUpdate: { lastAccessedAt: Date; currentIndex?: number } = {
      lastAccessedAt: new Date(),
    }
    if (typeof data.paperQuestionIndex === 'number') {
      paperSessionUpdate.currentIndex = data.paperQuestionIndex
    }
    await prisma.paperPracticeSession.updateMany({
      where: { id: data.paperSessionId, userId, status: 'active' },
      data: paperSessionUpdate,
    })
  }

  // 答错 → 自动创建 UserError（进入错题本，开始间隔复习）
  if (!isCorrect) {
    const existing = await prisma.userError.findUnique({
      where: { userId_questionId: { userId, questionId } },
    })
    let userErrorId = existing?.id ?? null
    if (!existing) {
      await prisma.userError.create({
        data: {
          userId,
          questionId,
          myAnswer:      data.selectedAnswer ?? '',
          errorReason:   '真题练习答错',
          masteryPercent: 0,
          reviewInterval: 1,
          nextReviewAt:   new Date(),
          isHot:          false,
          isStockified:   false,
          reboundAlert:   false,
        },
      })

      const created = await prisma.userError.findUnique({
        where: { userId_questionId: { userId, questionId } },
        select: { id: true },
      })
      userErrorId = created?.id ?? null

      if (created) {
        attachErrorToKnowledgeNote({
          userId,
          userErrorId: created.id,
          question: {
            type: question.type,
            subtype: question.subtype,
            sub2: question.sub2,
            skillTags: question.skillTags,
            content: question.content,
          },
          knowledgeTitle: question.sub2 || question.subtype || question.type,
          summary: '真题练习答错后自动沉淀的知识点草稿',
        }).catch(() => {})
      }

      // 异步触发 AI 诊断
      const { triggerPostRecordDiagnosis } = await import('@/lib/ai-diagnosis')
      triggerPostRecordDiagnosis(
        (await prisma.userError.findUniqueOrThrow({ where: { userId_questionId: { userId, questionId } } })).id,
        questionId
      ).catch((e: Error) => console.error('[AI] 真题诊断失败：', e.message))
    }

    logPracticeAnswer(userId, {
      questionId,
      questionType:    question.type,
      questionSubtype: question.subtype ?? undefined,
      masteryBefore:   existing?.masteryPercent ?? 0,
      masteryAfter:    0,
      isCorrect:       false,
      timeSpent,
      isSlowCorrect,
      thinkingVerdict: data.thinkingVerdict ?? undefined,
      resultMatrix:    '4',
      practiceMode:    data.practiceMode,
      reviewInterval:  1,
    }, data.sessionId).catch(() => {})

    return NextResponse.json({
      success:          true,
      addedToErrorBook: true,
      userErrorId,
      masteryPercent:   0,
      isStockified:     false,
      resultMatrix:     '4',
      wasStockifiedNow: false,
    })
  }

  logPracticeAnswer(userId, {
    questionId,
    questionType:    question.type,
    questionSubtype: question.subtype ?? undefined,
    masteryBefore:   0,
    masteryAfter:    100,
    isCorrect:       true,
    timeSpent,
    isSlowCorrect,
    thinkingVerdict: data.thinkingVerdict ?? undefined,
    resultMatrix:    '1',
    practiceMode:    data.practiceMode,
    reviewInterval:  7,
  }, data.sessionId).catch(() => {})

  // 答对 → 只记录结果，不进错题本
  return NextResponse.json({
    success:          true,
    addedToErrorBook: false,
    masteryPercent:   100,
    isStockified:     false,
    resultMatrix:     '1',
    wasStockifiedNow: false,
  })
}
