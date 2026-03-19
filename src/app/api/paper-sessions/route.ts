import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const paperAnswerSchema = z.object({
  selected: z.string(),
  timeSpentSeconds: z.number().int().nonnegative().optional(),
  submitResult: z.unknown().optional(),
}).passthrough()

const paperSessionStepSchema = z.enum([
  'paper_intro',
  'answering',
  'thinking',
  'revealed',
  'paper_submit',
  'done',
])

const baseSnapshotSchema = z.object({
  paperKey: z.string().min(1),
  paperTitle: z.string().optional().nullable(),
  paperYear: z.string().optional().nullable(),
  paperProvince: z.string().optional().nullable(),
  paperExamType: z.string().optional().nullable(),
  totalQuestions: z.number().int().nonnegative().optional(),
  currentIndex: z.number().int().nonnegative().default(0),
  step: paperSessionStepSchema.default('paper_intro'),
  answered: z.array(z.number().int().nonnegative()).default([]),
  marked: z.array(z.number().int().nonnegative()).default([]),
  answers: z.record(z.string(), paperAnswerSchema).default({}),
  sessionId: z.string().optional().nullable(),
})

const actionSchema = z.object({
  action: z.enum(['start', 'sync', 'complete', 'restart']).default('start'),
}).and(baseSnapshotSchema.partial({
  paperKey: true,
  paperTitle: true,
  paperYear: true,
  paperProvince: true,
  paperExamType: true,
  totalQuestions: true,
  currentIndex: true,
  step: true,
  answered: true,
  marked: true,
  answers: true,
  sessionId: true,
}))

type PaperSessionRow = {
  id: string
  paperKey: string
  paperTitle: string | null
  paperYear: string | null
  paperProvince: string | null
  paperExamType: string | null
  totalQuestions: number
  activitySessionId: string
  currentIndex: number
  step: string
  status: string
  answeredIndices: string
  markedIndices: string
  answersJson: string
  startedAt: Date
  lastAccessedAt: Date
  completedAt: Date | null
}

function parseJsonArray(value: string | null | undefined): number[] {
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

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function serializeAnswers(answers: Record<string, unknown>) {
  const ordered = Object.fromEntries(
    Object.entries(answers).sort(([a], [b]) => Number(a) - Number(b))
  )
  return JSON.stringify(ordered)
}

function parseSession(row: PaperSessionRow) {
  return {
    id: row.id,
    paperKey: row.paperKey,
    paperTitle: row.paperTitle,
    paperYear: row.paperYear,
    paperProvince: row.paperProvince,
    paperExamType: row.paperExamType,
    totalQuestions: row.totalQuestions,
    activitySessionId: row.activitySessionId,
    currentIndex: row.currentIndex,
    step: row.step as 'paper_intro' | 'answering' | 'thinking' | 'revealed' | 'paper_submit' | 'done',
    status: row.status as 'active' | 'completed' | 'abandoned',
    answered: parseJsonArray(row.answeredIndices),
    marked: parseJsonArray(row.markedIndices),
    answers: parseJsonObject(row.answersJson) as Record<string, {
      selected: string
      timeSpentSeconds?: number
      submitResult?: unknown
    }>,
    startedAt: row.startedAt.toISOString(),
    lastAccessedAt: row.lastAccessedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

async function getPaperSession(userId: string, paperKey: string) {
  const row = await prisma.paperPracticeSession.findFirst({
    where: { userId, paperKey, status: 'active' },
    orderBy: { lastAccessedAt: 'desc' },
  })
  return row ? parseSession(row as PaperSessionRow) : null
}

async function saveSessionSnapshot(userId: string, payload: z.infer<typeof actionSchema>) {
  const row = await prisma.paperPracticeSession.findFirst({
    where: { id: payload.sessionId ?? '', userId },
  })
  if (!row) {
    return null
  }

  const updated = await prisma.paperPracticeSession.update({
    where: { id: row.id },
    data: {
      paperTitle: payload.paperTitle ?? row.paperTitle,
      paperYear: payload.paperYear ?? row.paperYear,
      paperProvince: payload.paperProvince ?? row.paperProvince,
      paperExamType: payload.paperExamType ?? row.paperExamType,
      totalQuestions: payload.totalQuestions ?? row.totalQuestions,
      currentIndex: payload.currentIndex ?? row.currentIndex,
      step: payload.step ?? row.step,
      answeredIndices: JSON.stringify(payload.answered ?? parseJsonArray(row.answeredIndices)),
      markedIndices: JSON.stringify(payload.marked ?? parseJsonArray(row.markedIndices)),
      answersJson: payload.answers ? serializeAnswers(payload.answers as Record<string, unknown>) : row.answersJson,
      lastAccessedAt: new Date(),
      status: payload.action === 'complete' ? 'completed' : row.status,
      completedAt: payload.action === 'complete' ? new Date() : row.completedAt,
    },
  })

  return parseSession(updated as PaperSessionRow)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const paperKey = searchParams.get('paper')
  if (!paperKey) return NextResponse.json({ error: '缺少 paper 参数' }, { status: 400 })

  const paperSession = await getPaperSession(userId, paperKey)
  return NextResponse.json({ paperSession })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = actionSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const data = parsed.data
  if (!data.paperKey) return NextResponse.json({ error: '缺少 paperKey' }, { status: 400 })

  if (data.action === 'restart') {
    await prisma.paperPracticeSession.updateMany({
      where: { userId, paperKey: data.paperKey, status: 'active' },
      data: { status: 'abandoned', completedAt: new Date(), step: 'done', lastAccessedAt: new Date() },
    })
  }

  const active = await prisma.paperPracticeSession.findFirst({
    where: { userId, paperKey: data.paperKey, status: 'active' },
    orderBy: { lastAccessedAt: 'desc' },
  })

  if (active && data.action !== 'restart') {
    if (data.action === 'sync' || data.action === 'complete') {
      const updated = await saveSessionSnapshot(userId, {
        ...data,
        sessionId: active.id,
      })
      return NextResponse.json({ paperSession: updated })
    }

    return NextResponse.json({ paperSession: parseSession(active as PaperSessionRow) })
  }

  if (data.action === 'sync' || data.action === 'complete') {
    return NextResponse.json({ error: '会话不存在' }, { status: 404 })
  }

  const now = new Date()
  const created = await prisma.paperPracticeSession.create({
    data: {
      userId,
      paperKey: data.paperKey,
      paperTitle: data.paperTitle ?? null,
      paperYear: data.paperYear ?? null,
      paperProvince: data.paperProvince ?? null,
      paperExamType: data.paperExamType ?? null,
      totalQuestions: data.totalQuestions ?? 0,
      activitySessionId: crypto.randomUUID(),
      currentIndex: data.currentIndex ?? 0,
      step: data.step ?? 'paper_intro',
      status: 'active',
      answeredIndices: JSON.stringify(data.answered ?? []),
      markedIndices: JSON.stringify(data.marked ?? []),
      answersJson: serializeAnswers((data.answers ?? {}) as Record<string, unknown>),
      startedAt: now,
      lastAccessedAt: now,
    },
  })

  return NextResponse.json({ paperSession: parseSession(created as PaperSessionRow) })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = actionSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const data = parsed.data
  if (!data.sessionId) return NextResponse.json({ error: '缺少 sessionId' }, { status: 400 })

  const updated = await saveSessionSnapshot(userId, data)
  if (!updated) return NextResponse.json({ error: '会话不存在' }, { status: 404 })

  return NextResponse.json({ paperSession: updated })
}

