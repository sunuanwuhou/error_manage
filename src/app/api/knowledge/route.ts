// src/app/api/knowledge/route.ts
// 好题知识库 CRUD + AI 提取

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { processKnowledgeEntry } from '@/lib/ai/knowledge-extractor'
import { z } from 'zod'

const createSchema = z.object({
  questionContent: z.string().min(10),
  analysisContent: z.string().min(10),
  questionType:    z.string().min(1),
  questionId:      z.string().optional(),
  isPublic:        z.boolean().default(true),
})

// GET: 获取知识库列表
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  const entries = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, "userId", "isPublic", "questionType", "methodName",
           "applicableTypes", "triggerKeywords", "solutionSteps",
           "exampleSolution", "qualityScore", "usageCount", "rawContent",
           "aiExtractedAt", "createdAt"
    FROM knowledge_entries
    WHERE ("isPublic" = true OR "userId" = $1)
    ${type ? `AND "questionType" = '${type.replace(/'/g, "''")}'` : ''}
    ORDER BY "qualityScore" DESC, "usageCount" DESC
    LIMIT 50
  `, userId)

  return NextResponse.json(entries.map(e => ({
    ...e,
    applicableTypes: JSON.parse(e.applicableTypes ?? '[]'),
    triggerKeywords: JSON.parse(e.triggerKeywords ?? '[]'),
    solutionSteps:   JSON.parse(e.solutionSteps ?? '[]'),
    isOwn:           e.userId === userId,
  })))
}

// POST: 喂一道好题，AI 提取解法模式
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const d = parsed.data

  try {
    const { id, pattern } = await processKnowledgeEntry(
      userId,
      d.questionContent,
      d.analysisContent,
      d.questionType,
      d.questionId,
      d.isPublic
    )
    return NextResponse.json({ id, pattern }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: `AI 提取失败：${err.message}` }, { status: 500 })
  }
}

// DELETE: 删除自己的条目
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少id' }, { status: 400 })

  await prisma.$executeRawUnsafe(`
    DELETE FROM knowledge_entries WHERE id = $1 AND "userId" = $2
  `, id, userId)

  return NextResponse.json({ ok: true })
}
