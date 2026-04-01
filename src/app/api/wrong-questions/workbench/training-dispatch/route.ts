import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadWorkbenchState } from '@/lib/wrong-workbench-server-store'
import { loadMainlineState } from '@/lib/mainline-record-server-store'

type DispatchItem = {
  id: string
  questionId: string
  content: string
  questionType?: string
  errorReason?: string
  masteryPercent?: number
  nextReviewAt?: string | null
  dispatchReason: string
  dispatchPriority: number
  trainingMode?: string
  wrongStepIndex?: number
  retrainHref?: string
}

function buildSavedMaps(state: Awaited<ReturnType<typeof loadWorkbenchState>>) {
  const noteSaved: Record<string, boolean> = {}
  const noteCompleted: Record<string, boolean> = {}
  const knowledgeSaved: Record<string, boolean> = {}
  const knowledgeCompleted: Record<string, boolean> = {}

  state.notes.forEach(item => {
    const key = `${item.wrongId}__${item.questionId}`
    noteSaved[key] = true
    if (item.completed) noteCompleted[key] = true
  })
  state.knowledgeLinks.forEach(item => {
    const key = `${item.wrongId}__${item.questionId}`
    knowledgeSaved[key] = true
    if (item.completed) knowledgeCompleted[key] = true
  })

  return { noteSaved, noteCompleted, knowledgeSaved, knowledgeCompleted }
}

function classifyDispatch(args: {
  id: string
  questionId: string
  masteryPercent?: number
  nextReviewAt?: string | null
  noteSaved: Record<string, boolean>
  noteCompleted: Record<string, boolean>
  knowledgeSaved: Record<string, boolean>
  knowledgeCompleted: Record<string, boolean>
}) {
  const key = `${args.id}__${args.questionId}`
  const hasNoteSaved = Boolean(args.noteSaved[key])
  const hasNoteCompleted = Boolean(args.noteCompleted[key])
  const hasKnowledgeSaved = Boolean(args.knowledgeSaved[key])
  const hasKnowledgeCompleted = Boolean(args.knowledgeCompleted[key])
  const due = Boolean(args.nextReviewAt)
  const lowMastery = Number(args.masteryPercent ?? 0) < 60

  if (!hasNoteSaved || !hasNoteCompleted) {
    return { reason: '优先补笔记', priority: 1 }
  }
  if (!hasKnowledgeSaved || !hasKnowledgeCompleted) {
    return { reason: '优先挂知识点', priority: 2 }
  }
  if (due) {
    return { reason: '优先清待复习', priority: 3 }
  }
  if (lowMastery) {
    return { reason: '优先清低掌握度', priority: 4 }
  }
  return { reason: '常规错题再练', priority: 5 }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const [wrongItems, state, mainline] = await Promise.all([
    prisma.userError.findMany({
      where: { userId },
      include: { question: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
    loadWorkbenchState(userId),
    loadMainlineState(userId),
  ])

  const maps = buildSavedMaps(state)

  const items: DispatchItem[] = wrongItems.map(item => {
    const dispatch = classifyDispatch({
      id: item.id,
      questionId: item.questionId,
      masteryPercent: item.masteryPercent ?? 0,
      nextReviewAt: item.nextReviewAt ? item.nextReviewAt.toISOString() : null,
      ...maps,
    })
    const latestAnalysis = mainline.analyses.find(analysis => analysis.questionId === item.questionId)

    return {
      id: item.id,
      questionId: item.questionId,
      content: item.question?.content || '',
      questionType: item.question?.type || '未分类',
      errorReason: item.errorReason || '',
      masteryPercent: item.masteryPercent ?? 0,
      nextReviewAt: item.nextReviewAt ? item.nextReviewAt.toISOString() : null,
      dispatchReason: dispatch.reason,
      dispatchPriority: dispatch.priority,
      trainingMode: latestAnalysis?.trainingMode || '',
      wrongStepIndex: latestAnalysis?.wrongStepIndex,
      retrainHref: `/wrong-questions/workbench/retrain?questionId=${item.questionId}`,
    }
  }).sort((a, b) => a.dispatchPriority - b.dispatchPriority)

  const summary = {
    noteFirst: items.filter(item => item.dispatchPriority === 1).length,
    knowledgeFirst: items.filter(item => item.dispatchPriority === 2).length,
    reviewFirst: items.filter(item => item.dispatchPriority === 3).length,
    masteryFirst: items.filter(item => item.dispatchPriority === 4).length,
    normal: items.filter(item => item.dispatchPriority === 5).length,
  }

  return NextResponse.json({ items, summary })
}
