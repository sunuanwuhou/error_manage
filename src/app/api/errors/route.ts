import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const { searchParams } = new URL(req.url)
  const q = String(searchParams.get('q') || '').trim()

  const items = await prisma.userError.findMany({
    where: {
      userId,
      ...(q ? { question: { content: { contains: q, mode: 'insensitive' } } } : {}),
    },
    include: { question: true },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({ items })
}
