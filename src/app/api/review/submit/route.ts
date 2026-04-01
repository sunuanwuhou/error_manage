import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildAttemptRecord, buildErrorAnalysis, buildReviewTask, scoreChoiceQuestion } from '@/lib/error-analysis'
import { patchProcessSessionRecord, patchReviewTasksByQuestion, upsertAnalysisRecord, upsertAttemptRecord, upsertReviewTaskRecord, upsertScoreRecord } from '@/lib/mainline-record-server-store'

const schema = z.object({
  questionId: z.string().min(1),
  userAnswer: z.string().min(1),
  timeSpent: z.number().int().nonnegative().optional(),
  fromPaper: z.boolean().optional(),
  attemptId: z.string().optional(),
  processSessionIds: z.array(z.string()).optional(),
  processSummary: z.string().optional(),
})

function parseOptions(raw?: string | null) {
  if (!raw) return []
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const data = parsed.data
  const question = await prisma.question.findUnique({ where: { id: data.questionId } })
  if (!question) return NextResponse.json({ error: '题目不存在' }, { status: 404 })

  const isCorrect = String(data.userAnswer).trim().toUpperCase() === String(question.answer).trim().toUpperCase()

  await prisma.practiceRecord.upsert({
    where: { userId_questionId: { userId, questionId: question.id } },
    update: { isCorrect, isPending: !isCorrect, questionType: question.type, nextShowAt: !isCorrect ? new Date() : null },
    create: { userId, questionId: question.id, isCorrect, isPending: !isCorrect, questionType: question.type, nextShowAt: !isCorrect ? new Date() : null },
  })

  const attemptRecord = buildAttemptRecord({
    questionId: question.id,
    userAnswer: data.userAnswer,
    processSessionIds: data.processSessionIds || [],
    answerMeta: {
      timeSpent: data.timeSpent || 0,
      fromPaper: Boolean(data.fromPaper),
      processSummary: data.processSummary || '',
      externalAttemptId: data.attemptId || '',
    },
  })
  const scoreRecord = scoreChoiceQuestion({
    questionId: question.id,
    attemptId: attemptRecord.attemptId,
    userAnswer: data.userAnswer,
    correctAnswer: question.answer,
    judgeMode: 'rule',
  })
  const analysisRecord = buildErrorAnalysis({
    questionId: question.id,
    attempt: attemptRecord,
    score: scoreRecord,
    correctAnswer: question.answer,
    processSummary: data.processSummary || '',
  })
  const reviewTask = buildReviewTask({
    questionId: question.id,
    attemptId: attemptRecord.attemptId,
    analysis: analysisRecord,
  })

  await Promise.all([
    upsertAttemptRecord(userId, attemptRecord),
    upsertScoreRecord(userId, scoreRecord),
    upsertAnalysisRecord(userId, analysisRecord),
    upsertReviewTaskRecord(userId, reviewTask),
    ...(data.processSessionIds || []).map(processSessionId => patchProcessSessionRecord(userId, processSessionId, {
      attemptId: attemptRecord.attemptId,
      endedAt: new Date().toISOString(),
      derivedMeta: {
        linkedAttemptId: attemptRecord.attemptId,
        scoreStatus: scoreRecord.scoreStatus,
        wrongStepIndex: analysisRecord.wrongStepIndex,
        errorTypePrimary: analysisRecord.errorTypePrimary,
      },
    })),
  ])

  let userErrorId: string | null = null
  let addedToErrorBook = false

  if (!isCorrect) {
    const existed = await prisma.userError.findUnique({ where: { userId_questionId: { userId, questionId: question.id } } })
    if (existed) {
      const updated = await prisma.userError.update({
        where: { id: existed.id },
        data: {
          myAnswer: data.userAnswer,
          reviewInterval: 1,
          nextReviewAt: new Date(),
          lastReviewedAt: new Date(),
          masteryPercent: Math.max(0, existed.masteryPercent - 10),
          reviewCount: { increment: 1 },
          reboundAlert: true,
          isHot: true,
        },
      })
      userErrorId = updated.id
    } else {
      const created = await prisma.userError.create({
        data: {
          userId, questionId: question.id, myAnswer: data.userAnswer,
          errorReason: data.fromPaper ? '套卷练习做错' : '练习做错',
          masteryPercent: 0, reviewInterval: 1, nextReviewAt: new Date(), isHot: true, reboundAlert: true,
        },
      })
      userErrorId = created.id
      addedToErrorBook = true
    }
  } else {
    const existed = await prisma.userError.findUnique({ where: { userId_questionId: { userId, questionId: question.id } } })
    if (existed) {
      userErrorId = existed.id
      await prisma.userError.update({
        where: { id: existed.id },
        data: {
          reviewCount: { increment: 1 },
          correctCount: { increment: 1 },
          masteryPercent: Math.min(100, existed.masteryPercent + 15),
          reboundAlert: false,
          isHot: false,
          isLastSlowCorrect: (data.timeSpent || 0) > 120,
          lastReviewedAt: new Date(),
          nextReviewAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
      })
    }

    await patchReviewTasksByQuestion(userId, question.id, {
      status: 'completed',
      updatedAt: new Date().toISOString(),
      description: [reviewTask.description || '', '系统回写：用户已重新作对，当前复盘任务自动完成。'].filter(Boolean).join('\n'),
    })
  }

  return NextResponse.json({
    isCorrect,
    correctAnswer: question.answer,
    analysis: question.analysis || '',
    options: parseOptions(question.options),
    addedToErrorBook,
    userErrorId,
    attemptId: attemptRecord.attemptId,
    scoreRecord,
    errorAnalysis: analysisRecord,
    reviewTask,
  })
}
