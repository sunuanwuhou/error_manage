// src/app/api/mock-tests/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { differenceInDays } from 'date-fns'

const createSchema = z.object({
  sourceName:    z.string().min(1),
  examType:      z.string().default('guo_kao'),
  totalScore:    z.number().int().min(0).max(200),
  totalScoreMax: z.number().int().default(100),
  scoreJson:     z.record(z.number()).optional(),
  testDate:      z.string().optional(),
  notes:         z.string().optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const records = await prisma.mockTestRecord.findMany({
    where:   { userId },
    orderBy: { testDate: 'desc' },
    take:    20,
  })

  return NextResponse.json(records.map(r => ({
    ...r,
    scoreJson: r.scoreJson ? JSON.parse(r.scoreJson) : null,
  })))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })

  const d = parsed.data
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { examDate: true } })
  const daysToExam = user.examDate ? differenceInDays(new Date(user.examDate), new Date()) : null

  const record = await prisma.mockTestRecord.create({
    data: {
      userId,
      sourceName:    d.sourceName,
      examType:      d.examType,
      totalScore:    d.totalScore,
      totalScoreMax: d.totalScoreMax,
      scoreJson:     d.scoreJson ? JSON.stringify(d.scoreJson) : null,
      testDate:      d.testDate ? new Date(d.testDate) : new Date(),
      notes:         d.notes,
      daysToExam,
    },
  })

  return NextResponse.json(record, { status: 201 })
}
