import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const createSchema = z.object({
  paperKey: z.string().min(1),
  paperTitle: z.string().optional(),
  paperYear: z.string().optional(),
  paperProvince: z.string().optional(),
  paperExamType: z.string().optional(),
  totalQuestions: z.number().int().nonnegative().default(0),
  snapshot: z.object({
    currentIndex: z.number().int().nonnegative().default(0),
    step: z.string().default('paper_intro'),
    answered: z.array(z.number()).default([]),
    marked: z.array(z.number()).default([]),
    answers: z.record(z.any()).default({}),
  }).optional(),
})

const patchSchema = z.object({
  sessionId: z.string().min(1),
  currentIndex: z.number().int().nonnegative().optional(),
  step: z.string().optional(),
  answered: z.array(z.number()).optional(),
  marked: z.array(z.number()).optional(),
  answers: z.record(z.any()).optional(),
  status: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const { searchParams } = new URL(req.url)
  const paperKey = searchParams.get('paperKey')
  if (!paperKey) return NextResponse.json({ error: '缺少 paperKey' }, { status: 400 })

  const record = await prisma.paperPracticeSession.findFirst({
    where: { userId, paperKey, status: 'active' },
    orderBy: { lastAccessedAt: 'desc' },
  })
  return NextResponse.json({ session: record })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const data = parsed.data
  const sessionRecord = await prisma.paperPracticeSession.create({
    data: {
      userId,
      paperKey: data.paperKey,
      paperTitle: data.paperTitle || null,
      paperYear: data.paperYear || null,
      paperProvince: data.paperProvince || null,
      paperExamType: data.paperExamType || null,
      totalQuestions: data.totalQuestions,
      activitySessionId: `paper-${Date.now()}`,
      currentIndex: data.snapshot?.currentIndex || 0,
      step: data.snapshot?.step || 'paper_intro',
      answeredIndices: JSON.stringify(data.snapshot?.answered || []),
      markedIndices: JSON.stringify(data.snapshot?.marked || []),
      answersJson: JSON.stringify(data.snapshot?.answers || {}),
      status: 'active',
    },
  })
  return NextResponse.json({ session: sessionRecord }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const data = parsed.data
  const record = await prisma.paperPracticeSession.findFirst({ where: { id: data.sessionId, userId } })
  if (!record) return NextResponse.json({ error: '会话不存在' }, { status: 404 })

  const updated = await prisma.paperPracticeSession.update({
    where: { id: record.id },
    data: {
      currentIndex: data.currentIndex ?? record.currentIndex,
      step: data.step ?? record.step,
      answeredIndices: data.answered ? JSON.stringify(data.answered) : record.answeredIndices,
      markedIndices: data.marked ? JSON.stringify(data.marked) : record.markedIndices,
      answersJson: data.answers ? JSON.stringify(data.answers) : record.answersJson,
      status: data.status ?? record.status,
      completedAt: data.status === 'completed' ? new Date() : record.completedAt,
      lastAccessedAt: new Date(),
    },
  })

  return NextResponse.json({ session: updated })
}
