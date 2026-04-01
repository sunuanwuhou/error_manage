import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const db = prisma as any

const schema = z.object({
  dataUrl: z.string().min(1),
  altText: z.string().default('图片'),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const userId = (session.user as { id?: string }).id
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })

  const asset = await db.noteAsset.create({
    data: {
      userId,
      altText: parsed.data.altText,
      mimeType: parsed.data.dataUrl.slice(5, parsed.data.dataUrl.indexOf(';')) || 'image/png',
      dataUrl: parsed.data.dataUrl,
    },
    select: {
      id: true,
      altText: true,
      mimeType: true,
      dataUrl: true,
      createdAt: true,
    },
  })

  return NextResponse.json(asset, { status: 201 })
}
