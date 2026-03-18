// src/app/api/anchors/route.ts
// 记忆锚点列表（考前快速过用）

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const errors = await prisma.userError.findMany({
    where: {
      userId,
      isStockified: true,
      OR: [
        { personalMemoryAnchor: { not: null } },
        { question: { sharedMemoryAnchor: { not: null } } },
      ],
    },
    include: {
      question: { select: { type: true, subtype: true, sharedMemoryAnchor: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json(
    errors.map(e => ({
      id:       e.id,
      type:     e.question.type,
      subtype:  e.question.subtype,
      anchor:   e.personalMemoryAnchor ?? e.question.sharedMemoryAnchor,
      mastery:  e.masteryPercent,
    })).filter(e => e.anchor)
  )
}
