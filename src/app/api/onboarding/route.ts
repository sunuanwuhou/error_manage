// src/app/api/onboarding/route.ts
// 首次登录向导：保存考试目标配置

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  examType:      z.enum(['guo_kao', 'sheng_kao', 'tong_kao']),
  targetProvince: z.string().optional(),
  targetScore:   z.number().int().min(50).max(150),
  examDate:      z.string().optional(),  // ISO 日期字符串
  dailyGoal:     z.number().int().min(10).max(150).default(70),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const d = parsed.data
  await prisma.user.update({
    where: { id: userId },
    data: {
      examType:       d.examType,
      targetProvince: d.targetProvince ?? null,
      targetScore:    d.targetScore,
      examDate:       d.examDate ? new Date(d.examDate) : null,
      dailyGoal:      d.dailyGoal,
    },
  })

  return NextResponse.json({ ok: true })
}

// GET：检查当前用户是否已完成向导
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: userId },
    select: { examType: true, examDate: true, targetScore: true, dailyGoal: true, targetProvince: true },
  })

  // 没有 examDate 视为未完成向导
  const completed = !!user.examDate
  return NextResponse.json({ completed, ...user })
}
