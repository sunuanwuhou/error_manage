// src/app/api/review/session-summary/route.ts
// 练习结束后查询本次涨幅

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EVENT_TYPES } from '@/lib/activity/logger'
import { buildPaperModuleLabel, parsePaperModuleLabel, smoothPaperModuleLabels } from '@/lib/paper-modules'

function parseNumber(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseNumberList(value: string | null) {
  if (!value) return []
  return value
    .split(',')
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && item > 0)
}

function parsePaperArray(value: string | null | undefined) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(item => Number(item))
      .filter(item => Number.isFinite(item) && item >= 0)
  } catch {
    return []
  }
}

function sumPaperAnswerTimes(answers: Record<string, { timeSpentSeconds?: number }>) {
  return Object.values(answers).reduce((sum, answer) => sum + (answer.timeSpentSeconds ?? 0), 0)
}

function parsePaperObject(value: string | null | undefined) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, { timeSpentSeconds?: number }> : {}
  } catch {
    return {}
  }
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const since = searchParams.get('since')  // ISO 时间，本次练习开始时间
  const sessionId = searchParams.get('sessionId')
  const paper = searchParams.get('paper')
  const totalExpected = parseNumber(searchParams.get('totalExpected'))
  const durationSeconds = parseNumber(searchParams.get('durationSeconds'))
  const markedQuestions = parseNumberList(searchParams.get('markedQuestions'))
  const unansweredQuestions = parseNumberList(searchParams.get('unansweredQuestions'))
  if (!since) return NextResponse.json({ error: '缺少 since 参数' }, { status: 400 })

  const sinceDate = new Date(since)
  const paperSession = paper && sessionId
    ? await prisma.paperPracticeSession.findFirst({
        where: { userId, paperKey: paper, activitySessionId: sessionId },
      })
    : null

  if (paper && sessionId) {
    const events = await prisma.activityLog.findMany({
      where: {
        userId,
        eventType: EVENT_TYPES.PRACTICE_ANSWER,
        sessionId,
        createdAt: { gte: sinceDate },
      },
      orderBy: { createdAt: 'asc' },
      select: { payload: true },
    })

    const records = events.map(event => JSON.parse(event.payload))
    const total = records.length
    const correct = records.filter(r => r.isCorrect).length
    const slowCorrect = records.filter(r => r.isSlowCorrect).length
    const byType: Record<string, { correct: number; total: number }> = {}
    const byModule: Record<string, { correct: number; total: number; type: string; subtype?: string }> = {}
    const persistedAnswered = parsePaperArray(paperSession?.answeredIndices)
    const persistedMarked = parsePaperArray(paperSession?.markedIndices)
    const persistedAnswers = paperSession ? parsePaperObject(paperSession.answersJson) : {}
    const expectedTotal = totalExpected ?? paperSession?.totalQuestions ?? total
    const persistedDuration = sumPaperAnswerTimes(persistedAnswers)
    const wrong = total - correct

    records.forEach(record => {
      const type = record.questionType || '未分类'
      if (!byType[type]) byType[type] = { correct: 0, total: 0 }
      byType[type].total++
      if (record.isCorrect) byType[type].correct++
    })

    const smoothedModuleLabels = smoothPaperModuleLabels(
      records.map(record => buildPaperModuleLabel(record.questionType, record.questionSubtype))
    )

    records.forEach((record, index) => {
      const moduleLabel = smoothedModuleLabels[index]
      const parsedModule = parsePaperModuleLabel(moduleLabel)
      if (!byModule[moduleLabel]) {
        byModule[moduleLabel] = {
          correct: 0,
          total: 0,
          type: parsedModule.type,
          subtype: parsedModule.subtype,
        }
      }
      byModule[moduleLabel].total++
      if (record.isCorrect) byModule[moduleLabel].correct++
    })

    const byTypeList = Object.entries(byType)
      .map(([type, d]) => ({
        type,
        accuracy: Math.round((d.correct / d.total) * 100),
        total: d.total,
        correct: d.correct,
      }))
      .sort((a, b) => a.accuracy - b.accuracy || a.total - b.total)

    const byModuleList = Object.entries(byModule)
      .map(([module, data]) => ({
        module,
        type: data.type,
        subtype: data.subtype,
        accuracy: Math.round((data.correct / data.total) * 100),
        total: data.total,
        correct: data.correct,
      }))
      .sort((a, b) => a.accuracy - b.accuracy || a.total - b.total)

    const focusTypes = byTypeList.slice(0, 3).map(item => ({
      ...item,
      gapLabel: item.accuracy >= 80 ? '保持节奏' : item.accuracy >= 60 ? '优先补稳' : '立即回看',
    }))
    const focusModules = byModuleList.slice(0, 4).map(item => ({
      ...item,
      gapLabel: item.accuracy >= 80 ? '保持节奏' : item.accuracy >= 60 ? '优先补稳' : '立即回看',
    }))
    const firstUnansweredQuestion = unansweredQuestions[0] ?? null
    const firstMarkedQuestion = markedQuestions[0] ?? null
    const primaryFocusModule = focusModules[0]?.module ?? null
    const recommendedNextAction =
      unansweredQuestions.length > 0
        ? `先补 ${unansweredQuestions.length} 道未作答题，再复看弱模块。`
        : focusModules.length > 0
          ? `优先重做 ${focusModules[0].module}，把这个模块先拉稳。`
          : markedQuestions.length > 0
            ? `先回看 ${markedQuestions.length} 道存疑题，巩固稳定性。`
            : '这套卷已经完成，可以直接进入下一套或回到总进度。'

    const completionRate = expectedTotal > 0 ? Math.round((total / expectedTotal) * 100) : 0
    const completed = total >= expectedTotal && expectedTotal > 0
    const statusLabel = completed ? '整卷已交完' : '还有未完成题目'
    const statusDetail = completed
      ? focusModules[0]
        ? `这套卷已完成 ${completionRate}% ，当前最弱模块是 ${focusModules[0].module}，可以先回看它再决定是否重做。`
        : `这套卷已完成 ${completionRate}% ，可以先看弱项，再决定是否重做。`
      : `还差 ${Math.max(0, expectedTotal - total)} 题，建议先补完未作答，再看总结和弱项。`
    const reviewHint = focusTypes[0]
      ? `优先回看 ${focusTypes[0].type}，它当前正确率 ${focusTypes[0].accuracy}% 。`
      : '这套卷没有形成明显弱项，先稳住节奏并保持整卷训练。'

    return NextResponse.json({
      total,
      correct,
      wrong,
      newStockified: 0,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      slowCorrect,
      byType: byTypeList,
      stockifiedItems: [],
      paperStats: {
        totalExpected: expectedTotal,
        answered: Math.max(total, persistedAnswered.length),
        completionRate,
        durationSeconds: durationSeconds ?? (persistedDuration > 0 ? persistedDuration : records.reduce((sum, record) => sum + (record.timeSpent ?? 0), 0)),
        markedCount: markedQuestions.length || persistedMarked.length,
        unansweredCount: unansweredQuestions.length || Math.max(0, expectedTotal - persistedAnswered.length),
        markedQuestions: markedQuestions.length > 0 ? markedQuestions : persistedMarked.map(item => item + 1),
        unansweredQuestions: unansweredQuestions.length > 0
          ? unansweredQuestions
          : Array.from({ length: expectedTotal }, (_, i) => i + 1).filter(questionNo => !persistedAnswered.includes(questionNo - 1)),
        completed,
        statusLabel,
        statusDetail,
        reviewHint,
        focusTypes,
        byModule: byModuleList,
        focusModules,
        recommendedNextAction,
        firstUnansweredQuestion,
        firstMarkedQuestion,
        primaryFocusModule,
      },
    })
  }

  // 本次练习的所有提交记录
  const records = await prisma.reviewRecord.findMany({
    where:   { userId, createdAt: { gte: sinceDate } },
    include: { userError: { include: { question: { select: { type: true } } } } },
    orderBy: { createdAt: 'asc' },
  })

  const total       = records.length
  const correct     = records.filter(r => r.isCorrect).length
  const wrong       = total - correct
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
    total, correct, wrong, newStockified: todayStockified.length,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    slowCorrect,
    byType: Object.entries(byType).map(([type, d]) => ({
      type,
      accuracy: Math.round((d.correct / d.total) * 100),
      total:    d.total,
      correct:  d.correct,
    })),
    stockifiedItems: todayStockified.map(e => ({
      type: e.question.type,
      subtype: e.question.subtype,
      masteryPercent: e.masteryPercent,
    })),
  })
}
