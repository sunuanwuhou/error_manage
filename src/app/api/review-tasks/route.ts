import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadMainlineState } from '@/lib/mainline-record-server-store'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const { searchParams } = new URL(req.url)
  const status = String(searchParams.get('status') || '').trim()
  const questionId = String(searchParams.get('questionId') || '').trim()

  const state = await loadMainlineState(userId)
  const items = state.reviewTasks
    .filter(item => (!status || item.status === status) && (!questionId || item.questionId === questionId))
    .map(item => ({
      ...item,
      analysis: state.analyses.find(analysisItem => analysisItem.analysisId === (item.analysisId || item.sourceAnalysisId)) || null,
      attempt: state.attempts.find(attemptItem => attemptItem.attemptId === (item.attemptId || item.sourceAttemptId)) || null,
    }))
    .sort((a, b) => a.priority - b.priority || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return NextResponse.json({ items })
}
