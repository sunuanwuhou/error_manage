import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  examType: z.enum(['guo_kao', 'sheng_kao', 'tong_kao']),
  targetProvince: z.string().nullable().optional(),
  targetScore: z.number().int().min(50).max(150),
  examDate: z.string().optional(),
  dailyGoal: z.number().int().min(10).max(150).default(70),
})

async function ensureCompletionTimestamp(userId: string, onboardingCompletedAt: Date | null, hasConfigFootprint: boolean) {
  if (onboardingCompletedAt || !hasConfigFootprint) return onboardingCompletedAt
  const now = new Date()
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingCompletedAt: now },
  }).catch(() => {})
  return now
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data
  if (d.examType === 'sheng_kao' && !d.targetProvince?.trim()) {
    return NextResponse.json({ error: '省考请填写目标省份' }, { status: 400 })
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        examType: d.examType,
        targetProvince: d.examType === 'sheng_kao' ? d.targetProvince?.trim() ?? null : null,
        targetScore: d.targetScore,
        examDate: d.examDate ? new Date(d.examDate) : null,
        dailyGoal: d.dailyGoal,
        onboardingCompletedAt: new Date(),
      },
    })
  } catch (error: any) {
    const message = error?.code === 'P2025'
      ? '当前登录状态已过期，请重新登录后再保存'
      : error?.message ?? '保存失败，请稍后重试'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, completed: true })
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      examType: true,
      examDate: true,
      targetScore: true,
      dailyGoal: true,
      targetProvince: true,
      onboardingCompletedAt: true,
    },
  })

  const hasConfigFootprint = Boolean(user.examType) && typeof user.targetScore === 'number' && typeof user.dailyGoal === 'number'
  const onboardingCompletedAt = await ensureCompletionTimestamp(userId, user.onboardingCompletedAt, hasConfigFootprint)

  return NextResponse.json({
    ...user,
    onboardingCompletedAt,
    completed: Boolean(onboardingCompletedAt),
  })
}
