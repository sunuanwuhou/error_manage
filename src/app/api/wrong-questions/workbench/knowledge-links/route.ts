import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { getKnowledgeRecord, loadWorkbenchState, upsertKnowledgeRecord } from '@/lib/wrong-workbench-server-store'

const postSchema = z.object({
  wrongId: z.string().min(1),
  questionId: z.string().min(1),
  moduleName: z.string().optional(),
  nodeName: z.string().optional(),
  reason: z.string().optional(),
  completed: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const wrongId = String(searchParams.get('wrongId') || '').trim()
  const questionId = String(searchParams.get('questionId') || '').trim()

  if (wrongId && questionId) {
    const item = await getKnowledgeRecord(userId, wrongId, questionId)
    return NextResponse.json({ item })
  }

  const state = await loadWorkbenchState(userId)
  return NextResponse.json({ items: state.knowledgeLinks })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = postSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const record = await upsertKnowledgeRecord(userId, {
    wrongId: data.wrongId,
    questionId: data.questionId,
    moduleName: data.moduleName || '',
    nodeName: data.nodeName || '',
    reason: data.reason || '',
    completed: Boolean(data.completed),
    updatedAt: new Date().toISOString(),
  })

  return NextResponse.json({ item: record })
}
