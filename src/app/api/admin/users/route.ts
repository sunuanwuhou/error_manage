// src/app/api/admin/users/route.ts
// 管理员账号管理 API（§二.6）

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { addDays } from 'date-fns'
import { z } from 'zod'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const role = (session.user as any).role
  if (role !== 'admin') return null
  return session
}

// GET /api/admin/users — 用户列表
export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: '无权限' }, { status: 403 })

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, username: true, role: true,
      isActive: true, passwordExpireAt: true,
      examType: true, targetScore: true, examDate: true,
      createdAt: true,
      _count: { select: { userErrors: true } },
    },
  })

  return NextResponse.json(users)
}

// POST /api/admin/users — 创建账号
const createSchema = z.object({
  username:      z.string().min(2).max(32),
  password:      z.string().min(6),
  role:          z.enum(['user', 'admin']).default('user'),
  expireDays:    z.number().int().min(1).max(3650).default(365),
})

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: '无权限' }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const d = parsed.data
  const existing = await prisma.user.findUnique({ where: { username: d.username } })
  if (existing) return NextResponse.json({ error: '用户名已存在' }, { status: 409 })

  const passwordHash = await bcrypt.hash(d.password, 12)
  const user = await prisma.user.create({
    data: {
      username:        d.username,
      passwordHash,
      role:            d.role,
      passwordExpireAt: addDays(new Date(), d.expireDays),
      examType:        'guo_kao',
      targetScore:     85,
      dailyGoal:       70,
    },
    select: { id: true, username: true, role: true, passwordExpireAt: true },
  })

  return NextResponse.json(user, { status: 201 })
}

// PATCH /api/admin/users — 更新账号（封禁/重置密码/延期）
const updateSchema = z.object({
  userId:     z.string(),
  action:     z.enum(['toggle_active', 'reset_password', 'extend_expiry']),
  password:   z.string().min(6).optional(),
  expireDays: z.number().int().min(1).optional(),
})

export async function PATCH(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: '无权限' }, { status: 403 })

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })

  const d    = parsed.data
  const user = await prisma.user.findUnique({ where: { id: d.userId } })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  if (d.action === 'toggle_active') {
    await prisma.user.update({ where: { id: d.userId }, data: { isActive: !user.isActive } })
  } else if (d.action === 'reset_password' && d.password) {
    const passwordHash = await bcrypt.hash(d.password, 12)
    await prisma.user.update({
      where: { id: d.userId },
      data:  { passwordHash, passwordExpireAt: addDays(new Date(), d.expireDays ?? 365) },
    })
  } else if (d.action === 'extend_expiry' && d.expireDays) {
    await prisma.user.update({
      where: { id: d.userId },
      data:  { passwordExpireAt: addDays(new Date(), d.expireDays) },
    })
  }

  return NextResponse.json({ ok: true })
}
