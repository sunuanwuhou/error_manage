// src/app/api/practice/modes/route.ts
// 练习模式专用队列：计时训练 / 同错因聚焦

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const mode     = searchParams.get('mode')   // 'timed' | 'focused'
  const errorTag = searchParams.get('tag')    // focused 模式的错因 tag

  if (mode === 'timed') {
    // B1: 计时训练 — 连续3次 isSlowCorrect 的题（§0.7②）
    const errors = await prisma.userError.findMany({
      where: {
        userId,
        isLastSlowCorrect: true,
        isStockified: false,
      },
      include: { question: { select: { id: true, type: true, content: true, options: true, answer: true, analysis: true, sharedAiAnalysis: true } } },
      orderBy: { masteryPercent: 'desc' },
      take: 20,
    })
    return NextResponse.json({ mode: 'timed', items: errors.map(e => ({
      userErrorId: e.id, questionId: e.questionId,
      masteryPercent: e.masteryPercent, questionType: e.question.type,
      isHot: e.isHot, question: e.question,
      aiActionRule: e.aiActionRule, aiThinking: e.aiThinking,
      reviewCount: e.reviewCount,
    })) })
  }

  if (mode === 'focused') {
    // B2: 同错因聚焦 — 同一 errorReason/aiReasonTag 的5-8题（§5.0）
    const tag = errorTag ?? ''
    const errors = await prisma.userError.findMany({
      where: {
        userId,
        isStockified: false,
        OR: tag ? [
          { aiReasonTag: tag },
          { reasonTag: tag },
        ] : [{ aiReasonTag: { not: null } }],
      },
      include: { question: { select: { id: true, type: true, content: true, options: true, answer: true, analysis: true, sharedAiAnalysis: true } } },
      orderBy: { masteryPercent: 'asc' },
      take: 8,
    })
    return NextResponse.json({ mode: 'focused', tag, items: errors.map(e => ({
      userErrorId: e.id, questionId: e.questionId,
      masteryPercent: e.masteryPercent, questionType: e.question.type,
      isHot: e.isHot, question: e.question,
      aiActionRule: e.aiActionRule, aiThinking: e.aiThinking,
      reviewCount: e.reviewCount,
    })) })
  }

  // 列出可用的错因 tag（供 focused 模式选择）
  const tags = await prisma.userError.groupBy({
    by: ['aiReasonTag'],
    where: { userId, aiReasonTag: { not: null }, isStockified: false },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  })
  return NextResponse.json(tags.map(t => ({ tag: t.aiReasonTag, count: t._count.id })))
}
