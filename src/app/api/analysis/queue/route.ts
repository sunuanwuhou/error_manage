// src/app/api/analysis/queue/route.ts
// 分析队列管理：查看状态 + 手动触发单个任务

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET: 查看队列状态
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'all'

  const where: any = {}
  if (status !== 'all') where.status = status

  const [tasks, counts] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(`
      SELECT id, "targetType", "targetId", priority, status,
             "resultSummary", "analyzedAt", "createdAt", "retryCount", "failReason"
      FROM analysis_queue
      ${status !== 'all' ? `WHERE status = '${status}'` : ''}
      ORDER BY priority DESC, "createdAt" ASC
      LIMIT 100
    `),
    prisma.$queryRawUnsafe<any[]>(`
      SELECT status, COUNT(*)::int as count
      FROM analysis_queue
      GROUP BY status
    `),
  ])

  const countMap = Object.fromEntries(
    counts.map((c: any) => [c.status, c.count])
  )

  return NextResponse.json({ tasks, counts: countMap })
}

// POST: 手动触发单个任务（用于分析服务调用）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { action, taskId, targetType, targetId, priority } = await req.json()

  if (action === 'add') {
    // 手动添加任务
    await prisma.$executeRawUnsafe(`
      INSERT INTO analysis_queue (id, "triggeredBy","targetType","targetId","priority","status","createdAt","updatedAt")
      VALUES (gen_random_uuid()::text, 'manual', $1, $2, $3, 'pending', NOW(), NOW())
      ON CONFLICT DO NOTHING
    `, targetType, targetId, priority ?? 0.5)
    return NextResponse.json({ ok: true })
  }

  if (action === 'reset') {
    // 重置失败任务为 pending
    await prisma.$executeRawUnsafe(`
      UPDATE analysis_queue SET status='pending', "retryCount"=0, "failReason"=null, "updatedAt"=NOW()
      WHERE id=$1 AND status='failed'
    `, taskId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'mark_done') {
    // 分析服务完成后回写结果
    const { resultId, resultSummary } = await req.json()
    await prisma.$executeRawUnsafe(`
      UPDATE analysis_queue
      SET status='done', "resultId"=$2, "resultSummary"=$3, "analyzedAt"=NOW(), "updatedAt"=NOW()
      WHERE id=$1
    `, taskId, resultId, resultSummary)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '未知操作' }, { status: 400 })
}
