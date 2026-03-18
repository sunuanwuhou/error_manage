// src/app/api/analysis/gaps/route.ts
// 考点盲区检测（§21.3）
// 高频考点 - 用户已接触考点 = 盲区

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: userId },
    select: { examType: true, targetProvince: true },
  })

  // Step 1: 高频考点（frequency ≥ 5%）
  const topicStats = await prisma.examTopicStats.findMany({
    where: {
      examType:   user.examType,
      frequency:  { gte: 0.05 },
    },
    orderBy: { frequency: 'desc' },
  })

  if (topicStats.length === 0) {
    return NextResponse.json({ gaps: [], message: '暂无考点频率数据，请先导入真题' })
  }

  // Step 2: 用户已接触考点（做过错题 OR 做过真题练习）
  const [errorTags, practiceTags] = await Promise.all([
    prisma.userError.findMany({
      where:   { userId },
      include: { question: { select: { type: true, subtype: true, sub2: true, skillTags: true } } },
    }),
    prisma.practiceRecord.findMany({
      where:  { userId },
      select: { questionType: true },
    }),
  ])

  const touchedTags = new Set<string>()
  errorTags.forEach(e => {
    touchedTags.add(e.question.type)
    if (e.question.subtype) touchedTags.add(e.question.subtype)
    if (e.question.sub2)    touchedTags.add(e.question.sub2)
    if (e.question.skillTags) {
      try { JSON.parse(e.question.skillTags).forEach((t: string) => touchedTags.add(t)) } catch {}
    }
  })
  practiceTags.forEach(p => {
    if (p.questionType) touchedTags.add(p.questionType)
  })

  // Step 3: 差集 = 盲区
  const gaps = topicStats
    .filter(s => !touchedTags.has(s.skillTag))
    .map(s => ({
      skillTag:    s.skillTag,
      sectionType: s.sectionType,
      frequency:   s.frequency,
      freqPct:     Math.round(s.frequency * 100),
      // 预计提升分（保守估算）
      estimatedGain: parseFloat((s.frequency * 10 * 0.5).toFixed(1)),
      // 是否已有分析任务
      hasAnalysisTask: false,  // 后续可 JOIN analysis_queue 填充
    }))

  // Step 4: 查询哪些盲区已有分析任务
  if (gaps.length > 0) {
    const taskRows = await prisma.$queryRawUnsafe<Array<{ targetId: string; status: string }>>(
      `SELECT "targetId", status FROM analysis_queue
       WHERE "targetType"='skill_tag' AND "targetId" = ANY($1::text[])`,
      gaps.map(g => g.skillTag)
    )
    const taskMap = new Map(taskRows.map(r => [r.targetId, r.status]))
    gaps.forEach(g => {
      const s = taskMap.get(g.skillTag)
      ;(g as any).analysisStatus = s ?? null
    })
  }

  const totalEstimatedGain = gaps.reduce((sum, g) => sum + g.estimatedGain, 0)

  return NextResponse.json({
    gaps,
    touchedCount:  touchedTags.size,
    gapCount:      gaps.length,
    totalEstimatedGain: parseFloat(totalEstimatedGain.toFixed(1)),
  })
}
