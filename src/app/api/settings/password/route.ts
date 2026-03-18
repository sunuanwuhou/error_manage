// src/app/api/settings/password/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(6, '新密码至少6位'),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const match = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)
  if (!match) return NextResponse.json({ error: '当前密码错误' }, { status: 400 })

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)
  await prisma.user.update({
    where: { id: userId },
    data:  { passwordHash },
  })

  return NextResponse.json({ ok: true })
}
