import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const items = await prisma.importJob.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })

  return NextResponse.json({ items })
}
