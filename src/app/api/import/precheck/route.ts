import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const srcYear = String(body?.srcYear || '').trim()
  const srcProvince = String(body?.srcProvince || '').trim()
  const examType = String(body?.examType || '').trim()
  const srcSession = String(body?.srcSession || '').trim()

  if (!srcYear && !srcProvince && !examType && !srcSession) {
    return NextResponse.json({
      duplicated: false,
      message: '缺少用于预检查的来源信息',
      matchedQuestions: 0,
      matchedImportJobs: 0,
    })
  }

  const questionWhere: any = {}
  if (srcYear) questionWhere.srcYear = srcYear
  if (srcProvince) questionWhere.srcProvince = srcProvince
  if (examType) questionWhere.examType = examType
  if (srcSession) questionWhere.srcExamSession = srcSession

  const [matchedQuestions, matchedImportJobs] = await Promise.all([
    prisma.question.count({ where: questionWhere }),
    prisma.importJob.count({
      where: {
        OR: [
          srcYear ? { filename: { contains: srcYear } } : undefined,
          srcProvince ? { filename: { contains: srcProvince } } : undefined,
          srcSession ? { filename: { contains: srcSession } } : undefined,
        ].filter(Boolean) as any[],
      },
    }),
  ])

  const duplicated = matchedQuestions > 0 || matchedImportJobs > 0
  return NextResponse.json({
    duplicated,
    matchedQuestions,
    matchedImportJobs,
    message: duplicated
      ? '检测到同年/同省/同考试类型/同场次的历史数据，若继续导入，重复命中的题目将更新原题并保留 question.id。'
      : '未检测到明显重复导入风险。',
  })
}
