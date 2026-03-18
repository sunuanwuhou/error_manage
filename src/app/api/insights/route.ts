// src/app/api/insights/route.ts — 规律固化 CRUD（B4）
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  skillTag:      z.string().min(1),
  insightType:   z.enum(['rule', 'trap', 'formula']).default('rule'),
  aiDraft:       z.string().default(''),
  finalContent:  z.string().min(1),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const insights = await prisma.userInsight.findMany({
    where: { userId, isActive: true }, orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(insights)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })
  const insight = await prisma.userInsight.create({
    data: { userId, ...parsed.data },
  })
  return NextResponse.json(insight, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const { id, ...data } = await req.json()
  const existing = await prisma.userInsight.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: '不存在' }, { status: 404 })
  const updated = await prisma.userInsight.update({ where: { id }, data })
  return NextResponse.json(updated)
}
