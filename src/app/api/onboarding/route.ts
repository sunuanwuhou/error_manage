// src/app/api/onboarding/route.ts
// 首次登录向导：保存考试目标配置

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  examType:      z.enum(['guo_kao', 'sheng_kao', 'tong_kao']),
  targetProvince: z.string().nullable().optional(),
  targetScore:   z.number().int().min(50).max(150),
  examDate:      z.string().optional(),  // ISO 日期字符串
  dailyGoal:     z.number().int().min(10).max(150).default(70),
})

function hasLegacyConfig(user: {
  examType: string
  examDate: Date | null
  targetScore: number
  dailyGoal: number
  targetProvince: string | null
}) {
  return Boolean(
    user.examDate ||
    user.targetProvince ||
    user.targetScore !== 85 ||
    user.dailyGoal !== 70 ||
    user.examType !== 'guo_kao'
  )
}

async function ensureCompletionTimestamp(userId: string, completed: boolean, onboardingCompletedAt: Date | null) {
  if (!completed || onboardingCompletedAt) return onboardingCompletedAt
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
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const d = parsed.data
  if (d.examType === 'sheng_kao' && !d.targetProvince?.trim()) {
    return NextResponse.json({ error: '省考请填写目标省份' }, { status: 400 })
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        examType:       d.examType,
        targetProvince: d.examType === 'sheng_kao' ? d.targetProvince?.trim() ?? null : null,
        targetScore:    d.targetScore,
        examDate:       d.examDate ? new Date(d.examDate) : null,
        dailyGoal:      d.dailyGoal,
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

// GET：检查当前用户是否已完成向导
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: userId },
    select: {
      examType: true,
      examDate: true,
      targetScore: true,
      dailyGoal: true,
      targetProvince: true,
      onboardingCompletedAt: true,
    },
  })

  const legacyCompleted = hasLegacyConfig(user)
  const onboardingCompletedAt = await ensureCompletionTimestamp(userId, legacyCompleted, user.onboardingCompletedAt)

  return NextResponse.json({ completed: Boolean(onboardingCompletedAt), ...user, onboardingCompletedAt })
}
