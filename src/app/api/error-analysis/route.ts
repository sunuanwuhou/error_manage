import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { findAnalysisByAttempt, findLatestAnalysisByQuestion, listQuestionMainlineRecords } from '@/lib/mainline-record-server-store'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const { searchParams } = new URL(req.url)
  const questionId = String(searchParams.get('questionId') || '').trim()
  const attemptId = String(searchParams.get('attemptId') || '').trim()

  if (attemptId) {
    const analysis = await findAnalysisByAttempt(userId, attemptId)
    return NextResponse.json({ item: analysis })
  }

  if (questionId) {
    const [item, records] = await Promise.all([
      findLatestAnalysisByQuestion(userId, questionId),
      listQuestionMainlineRecords(userId, questionId),
    ])
    return NextResponse.json({ item, records })
  }

  return NextResponse.json({ error: '缺少 questionId 或 attemptId' }, { status: 400 })
}
