// src/app/api/practice/focused/route.ts — 同错因聚焦模式队列（B2）
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const tag = searchParams.get('tag')  // 错因标签，如"概念混淆"

  // 找该错因的题（5-8题）
  const where: any = { userId, isStockified: false }
  if (tag) {
    where.OR = [
      { aiReasonTag: tag },
      { reasonTag:   tag },
    ]
  }

  const errors = await prisma.userError.findMany({
    where,
    include: { question: { select: { id: true, content: true, options: true, answer: true, type: true, subtype: true, sharedAiAnalysis: true } } },
    orderBy: { masteryPercent: 'desc' },
    take: 8,
  })

  // 同时返回所有错因分布（供用户选择聚焦哪个）
  const allErrors = await prisma.userError.findMany({
    where:  { userId, isStockified: false },
    select: { aiReasonTag: true, reasonTag: true },
  })
  const tagMap: Record<string, number> = {}
  allErrors.forEach(e => {
    const t = e.aiReasonTag || e.reasonTag || '未分类'
    tagMap[t] = (tagMap[t] ?? 0) + 1
  })
  const availableTags = Object.entries(tagMap)
    .filter(([, c]) => c >= 2)
    .sort(([, a], [, b]) => b - a)
    .map(([tag, count]) => ({ tag, count }))

  return NextResponse.json({
    errors: errors.map(e => ({
      userErrorId:   e.id,
      questionId:    e.questionId,
      masteryPercent: e.masteryPercent,
      aiActionRule:  e.aiActionRule,
      aiThinking:    e.aiThinking,
      reviewCount:   e.reviewCount,
      question:      e.question,
    })),
    currentTag:   tag,
    availableTags,
  })
}
