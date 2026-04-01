import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const paper = searchParams.get('paper')
  const limit = Math.min(Number(searchParams.get('limit') || '20') || 20, 100)

  const where: any = { isPublic: true }
  if (paper) {
    const [srcYear, srcProvince, examType] = paper.split('__')
    if (srcYear && srcYear !== 'unknown') where.srcYear = srcYear
    if (srcProvince && srcProvince !== 'common') where.srcProvince = srcProvince
    if (examType && examType !== 'common') where.examType = examType
  }

  const items = await prisma.question.findMany({
    where,
    orderBy: [{ srcQuestionOrder: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  })

  return NextResponse.json({ items })
}
