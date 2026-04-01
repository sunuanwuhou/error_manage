import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findLatestAnalysisByQuestion, listProcessSessionsByQuestion, listProcessBundle } from '@/lib/mainline-record-server-store'
import { compareProcessWithStandard } from '@/lib/process-compare'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const { searchParams } = new URL(req.url)
  const questionId = String(searchParams.get('questionId') || '').trim()
  let processSessionId = String(searchParams.get('processSessionId') || '').trim()

  if (!questionId) return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })

  const question = await prisma.question.findUnique({ where: { id: questionId } })
  if (!question) return NextResponse.json({ error: '题目不存在' }, { status: 404 })

  const analysis = await findLatestAnalysisByQuestion(userId, questionId)
  if (!processSessionId) {
    processSessionId = analysis?.processIds?.[0] || ''
    if (!processSessionId) {
      const sessions = await listProcessSessionsByQuestion(userId, questionId)
      processSessionId = sessions[0]?.processSessionId || ''
    }
  }

  const bundle = processSessionId ? await listProcessBundle(userId, processSessionId) : null
  const processSummary = bundle?.snapshots?.find(item => item.stage === 'before_submit')?.blobRef || ''
  const compare = compareProcessWithStandard({
    questionContent: question.content,
    questionAnalysis: question.analysis,
    correctAnswer: question.answer,
    userAnswer: '',
    processSummary,
    wrongStepIndex: analysis?.wrongStepIndex,
    wrongStepText: analysis?.wrongStepText,
  })

  return NextResponse.json({
    item: compare,
    question: {
      id: question.id,
      content: question.content,
      analysis: question.analysis || '',
      answer: question.answer || '',
    },
    analysis,
    processSessionId,
  })
}
