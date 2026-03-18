// src/app/api/analysis/discussion/route.ts
// AI 分析结果讨论 API
// 用户可确认/否定/补充每条 finding，校正 AI 幻觉

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callAI } from '@/lib/ai/provider'
import { z } from 'zod'

const schema = z.object({
  snapshotId:   z.string(),
  findingIndex: z.number().int().min(0),
  action:       z.enum(['confirm', 'refute', 'supplement']),
  comment:      z.string().optional(),
})

// GET: 获取某快照的所有讨论
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const snapshotId = searchParams.get('snapshotId')
  if (!snapshotId) return NextResponse.json({ error: '缺少 snapshotId' }, { status: 400 })

  const discussions = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, "findingIndex", action, comment, "confidenceDelta", "aiResponse", "createdAt"
    FROM analysis_discussions
    WHERE "snapshotId" = $1 AND "userId" = $2
    ORDER BY "findingIndex" ASC, "createdAt" ASC
  `, snapshotId, (session.user as any).id)

  return NextResponse.json(discussions)
}

// POST: 提交讨论（确认/否定/补充）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })
  const d = parsed.data

  // 否定时必须填原因
  if (d.action === 'refute' && !d.comment?.trim()) {
    return NextResponse.json({ error: '否定时请填写原因，帮助 AI 改进' }, { status: 400 })
  }

  // 置信度变化
  const delta = d.action === 'confirm' ? 0.15 : d.action === 'refute' ? -0.7 : 0

  // 获取原 finding 内容（供 AI 回应）
  const snapshot = await prisma.$queryRawUnsafe<any[]>(`
    SELECT findings FROM analysis_snapshots WHERE id = $1
  `, d.snapshotId)

  let aiResponse: string | null = null

  if (snapshot.length > 0) {
    const findings = JSON.parse(snapshot[0].findings)
    const finding  = findings[d.findingIndex]

    if (finding && d.action !== 'confirm') {
      // AI 对用户反馈做简短回应（非阻塞）
      try {
        const prompt = d.action === 'refute'
          ? `我之前分析说："${finding.title}：${finding.detail}"
             用户否定了这个结论，原因是："${d.comment}"
             请用1-2句话承认这个修正，并说明下次分析会注意什么。不要辩解。`
          : `我之前分析说："${finding.title}：${finding.detail}"
             用户补充了："${d.comment}"
             请用1句话表示理解，并说明这个信息对分析的价值。`

        const res = await callAI([{ role: 'user', content: prompt }], { maxTokens: 100 })
        aiResponse = res.text.trim()
      } catch {}
    }
  }

  // 写入讨论记录
  await prisma.$executeRawUnsafe(`
    INSERT INTO analysis_discussions (
      id, "userId", "snapshotId", "findingIndex",
      action, comment, "confidenceDelta", "aiResponse", "createdAt"
    ) VALUES (
      gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW()
    )
  `, userId, d.snapshotId, d.findingIndex, d.action, d.comment ?? null, delta, aiResponse)

  // 更新 AnalysisSnapshot 的置信度（加权平均）
  // 同时把讨论摘要追加到 findings 里（供下次分析读取）
  const allDiscussions = await prisma.$queryRawUnsafe<any[]>(`
    SELECT "findingIndex", action, comment FROM analysis_discussions
    WHERE "snapshotId" = $1 AND "userId" = $2
  `, d.snapshotId, userId)

  // 按 findingIndex 聚合讨论
  const discussionMap: Record<number, string[]> = {}
  allDiscussions.forEach((disc: any) => {
    const i = disc.findingIndex
    if (!discussionMap[i]) discussionMap[i] = []
    const label = disc.action === 'confirm' ? '✅用户确认' : disc.action === 'refute' ? '❌用户否定' : '💬用户补充'
    discussionMap[i].push(`${label}${disc.comment ? '：' + disc.comment : ''}`)
  })

  // 把讨论注入到 findings（作为下次分析的上下文）
  if (snapshot.length > 0) {
    const findings = JSON.parse(snapshot[0].findings)
    const updatedFindings = findings.map((f: any, i: number) => ({
      ...f,
      userDiscussion: discussionMap[i] ?? [],
    }))
    await prisma.$executeRawUnsafe(`
      UPDATE analysis_snapshots
      SET findings = $1::jsonb, "updatedAt" = NOW()
      WHERE id = $2
    `, JSON.stringify(updatedFindings), d.snapshotId)
  }

  return NextResponse.json({ ok: true, aiResponse })
}
