import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { loadMainlineState, patchReviewTaskRecord } from '@/lib/mainline-record-server-store'

const patchSchema = z.object({
  status: z.enum(['pending', 'scheduled', 'in_progress', 'completed', 'ignored']),
  note: z.string().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const state = await loadMainlineState(userId)
  const current = state.reviewTasks.find(item => item.reviewTaskId === params.id)
  if (!current) return NextResponse.json({ error: '复盘任务不存在' }, { status: 404 })

  const now = new Date().toISOString()
  const note = String(parsed.data.note || '').trim()
  const updated = await patchReviewTaskRecord(userId, params.id, {
    status: parsed.data.status,
    updatedAt: now,
    description: note ? [current.description || '', `状态备注：${note}`].filter(Boolean).join('\n') : current.description,
  })

  return NextResponse.json({ item: updated })
}
