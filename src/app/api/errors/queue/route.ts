// src/app/api/errors/queue/route.ts
// 练习页统一队列 API
// 支持两种来源：
//   errorIds   = UserError IDs（错题复盘）
//   questionIds = Question IDs（真题练习）
// 返回格式统一，练习页无需区分来源

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const errorIdsParam    = searchParams.get('ids')       // 错题模式
  const questionIdsParam = searchParams.get('qids')      // 真题模式

  const result: any[] = []

  // ── 错题模式（UserError）─────────────────────────────────────
  if (errorIdsParam) {
    const ids = errorIdsParam.split(',').filter(Boolean)
    const errors = await prisma.userError.findMany({
      where:   { id: { in: ids }, userId },
      include: {
        question: {
          select: {
            id: true, content: true, options: true, answer: true,
            type: true, subtype: true, analysis: true,
            questionImage: true,
            sharedAiAnalysis: true, sharedMemoryAnchor: true, skillTags: true,
          },
        },
      },
    })

    const sorted = ids
      .map(id => errors.find(e => e.id === id))
      .filter(Boolean)
      .map(e => ({
        // F4: 加入个性化诊断字段
        userErrorId:    e!.id,
        questionId:     e!.questionId,
        masteryPercent: e!.masteryPercent,
        reviewCount:    e!.reviewCount,
        questionType:   e!.question.type,
        isHot:          e!.isHot,
        aiActionRule:   e!.aiActionRule,    // ← 之前缺失
        aiThinking:     e!.aiThinking,      // ← 之前缺失
        aiRootReason:   e!.aiRootReason,    // ← 之前缺失
        aiReasonTag:    e!.aiReasonTag,     // ← 之前缺失
        source:         'error' as const,
        question:       e!.question,
      }))
    result.push(...sorted)
  }

  // ── 真题模式（Question）──────────────────────────────────────
  // F1: 真题直接从 Question 表读取，不依赖 UserError
  if (questionIdsParam) {
    const qids = questionIdsParam.split(',').filter(Boolean)
    const questions = await prisma.question.findMany({
      where:  { id: { in: qids }, isPublic: true },
      select: {
        id: true, content: true, options: true, answer: true,
        type: true, subtype: true, analysis: true,
        questionImage: true,
        sharedAiAnalysis: true, sharedMemoryAnchor: true, skillTags: true,
      },
    })

    const sorted = qids
      .map(id => questions.find(q => q.id === id))
      .filter(Boolean)
      .map(q => ({
        userErrorId:    null,              // 真题没有 userErrorId
        questionId:     q!.id,
        masteryPercent: 0,
        reviewCount:    0,
        questionType:   q!.type,
        isHot:          false,
        aiActionRule:   null,
        aiThinking:     null,
        aiRootReason:   null,
        aiReasonTag:    null,
        source:         'practice' as const,
        question:       q!,
      }))
    result.push(...sorted)
  }

  return NextResponse.json(result)
}
