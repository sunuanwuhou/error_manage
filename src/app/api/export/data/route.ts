import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const userId = (session.user as any).id as string

  const [user, userErrors, notes, insights, mockTests, sectionStats, reviewRecords, practiceRecords, paperPracticeSessions, importJobs, activityLogs, analysisSnapshots, systemInsights, knowledgeEntries] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        role: true,
        examType: true,
        targetProvince: true,
        targetScore: true,
        examDate: true,
        dailyGoal: true,
        onboardingCompletedAt: true,
        createdAt: true,
      },
    }),
    prisma.userError.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        question: {
          select: {
            id: true,
            content: true,
            options: true,
            answer: true,
            analysis: true,
            type: true,
            subtype: true,
            skillTags: true,
            examType: true,
            srcYear: true,
            srcProvince: true,
            srcOrigin: true,
            srcExamSession: true,
            srcQuestionNo: true,
          },
        },
        reviews: {
          orderBy: { createdAt: 'asc' },
          select: {
            isCorrect: true,
            timeSpent: true,
            isSlowCorrect: true,
            thinkingVerdict: true,
            resultMatrix: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.userNote.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.userInsight.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.mockTestRecord.findMany({
      where: { userId },
      orderBy: { testDate: 'desc' },
    }),
    prisma.userSectionStats.findUnique({
      where: { userId },
    }),
    prisma.reviewRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        userError: {
          select: {
            id: true,
            questionId: true,
            masteryPercent: true,
            reasonTag: true,
            aiReasonTag: true,
            aiActionRule: true,
            aiNoteDraft: true,
          },
        },
      },
    }),
    prisma.practiceRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        questionId: true,
        isCorrect: true,
        isPending: true,
        nextShowAt: true,
        questionType: true,
        createdAt: true,
      },
    }),
    prisma.paperPracticeSession.findMany({
      where: { userId },
      orderBy: { lastAccessedAt: 'desc' },
    }),
    prisma.importJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.analysisSnapshot.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.systemInsight.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.knowledgeEntry.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  const payload = {
    exportedAt: new Date().toISOString(),
    version: '1.1',
    user,
    userErrors,
    notes,
    insights,
    mockTests,
    sectionStats,
    reviewRecords,
    practiceRecords,
    paperPracticeSessions,
    importJobs,
    activityLogs,
    analysisSnapshots,
    systemInsights,
    knowledgeEntries,
  }

  const filename = `error_manage_export_${user.username}_${new Date().toISOString().slice(0, 10)}.json`

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
