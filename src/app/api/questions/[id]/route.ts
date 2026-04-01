import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const item = await prisma.question.findUnique({
    where: { id: params.id },
  })

  if (!item) {
    return NextResponse.json({ error: '题目不存在' }, { status: 404 })
  }

  return NextResponse.json({ item })
}
