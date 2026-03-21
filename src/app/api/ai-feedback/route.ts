import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const createSchema = z.object({
  userId: z.string().optional(),
  sourceType: z.enum(['user_error_diagnosis', 'user_strategy_refresh']),
  sourceId: z.string().min(1),
  analysisType: z.enum(['user_error_diagnosis', 'user_strategy_refresh']).optional(),
  feedbackType: z.enum([
    'bias_correct',
    'bias_incorrect',
    'rule_effective',
    'rule_ineffective',
    'diagnosis_incorrect',
    'manual_override',
  ]),
  feedbackValue: z.string().optional(),
  comment: z.string().max(500).optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const sessionUserId = (session.user as any).id as string

  const { searchParams } = new URL(req.url)
  const sourceType = searchParams.get('sourceType')
  const sourceId = searchParams.get('sourceId')
  const userId = searchParams.get('userId') ?? sessionUserId
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 100)

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT id, "userId", "sourceType", "sourceId", "analysisType",
             "feedbackType", "feedbackValue", comment, "createdBy", "createdAt"
      FROM ai_feedback_logs
      WHERE ($1::text IS NULL OR "userId" = $1)
        AND ($2::text IS NULL OR "sourceType" = $2)
        AND ($3::text IS NULL OR "sourceId" = $3)
      ORDER BY "createdAt" DESC
      LIMIT $4
    `,
    userId,
    sourceType,
    sourceId,
    limit,
  ).catch((error: any) => {
    if (error?.code === '42P01') return []
    throw error
  })

  return NextResponse.json({ items: rows })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const createdBy = (session.user as any).id as string

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const targetUserId = data.userId ?? createdBy

  const sourceExists = data.sourceType === 'user_error_diagnosis'
    ? await prisma.userError.findFirst({ where: { id: data.sourceId, userId: targetUserId }, select: { id: true } })
    : await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM analysis_snapshots WHERE id = $1 AND ($2::text IS NULL OR "userId" = $2) LIMIT 1`,
        data.sourceId,
        targetUserId,
      ).then((rows) => rows[0] ?? null)

  if (!sourceExists) {
    return NextResponse.json({ error: '反馈目标不存在' }, { status: 404 })
  }

  const inserted = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `
      INSERT INTO ai_feedback_logs (
        id, "userId", "sourceType", "sourceId", "analysisType",
        "feedbackType", "feedbackValue", comment, "createdBy", "createdAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4,
        $5, $6, $7, $8, NOW()
      )
      RETURNING id
    `,
    targetUserId,
    data.sourceType,
    data.sourceId,
    data.analysisType ?? data.sourceType,
    data.feedbackType,
    data.feedbackValue ?? null,
    data.comment ?? null,
    createdBy,
  ).catch((error: any) => {
    if (error?.code === '42P01') {
      throw new Error('ai_feedback_logs table missing')
    }
    throw error
  })

  return NextResponse.json({ id: inserted[0]?.id ?? null })
}
