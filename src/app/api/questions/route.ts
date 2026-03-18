// src/app/api/questions/route.ts
// 题目库 API（公共层）

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/questions — 搜索题目
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q     = searchParams.get('q')
  const type  = searchParams.get('type')
  const limit = parseInt(searchParams.get('limit') ?? '20')

  const where: any = { isPublic: true }
  if (type) where.type = type
  if (q)    where.content = { contains: q }  // Phase 2 升级为 tsvector 全文检索

  const questions = await prisma.question.findMany({
    where,
    select: {
      id: true, content: true, type: true, subtype: true,
      answer: true, options: true, analysis: true,
      sharedAiAnalysis: true, examType: true, srcYear: true,
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 50),
  })

  return NextResponse.json(questions)
}
