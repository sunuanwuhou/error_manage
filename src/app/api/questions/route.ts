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
  const q = searchParams.get('q')?.trim() ?? ''
  const type = searchParams.get('type')?.trim() ?? ''
  const module2 = searchParams.get('module2')?.trim() ?? ''
  const module3 = searchParams.get('module3')?.trim() ?? ''
  const skillTag = searchParams.get('skillTag')?.trim() ?? ''
  const srcExamSession = searchParams.get('srcExamSession')?.trim() ?? ''
  const srcProvince = searchParams.get('srcProvince')?.trim() ?? ''
  const srcYear = searchParams.get('srcYear')?.trim() ?? ''
  const examType = searchParams.get('examType')?.trim() ?? ''
  const source = searchParams.get('source')?.trim() ?? ''
  const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 50))

  const where: any = { isPublic: true }
  const filters: any[] = []
  if (type) where.type = type
  if (module2) filters.push({ subtype: { contains: module2 } })
  if (module3) filters.push({ sub2: { contains: module3 } })
  if (skillTag) filters.push({ skillTags: { contains: skillTag } })
  if (srcExamSession) filters.push({ srcExamSession: { contains: srcExamSession } })
  if (srcProvince) filters.push({ srcProvince: { contains: srcProvince } })
  if (srcYear) filters.push({ srcYear: { contains: srcYear } })
  if (examType) filters.push({ examType: { contains: examType } })
  if (source) filters.push({ srcOrigin: { contains: source } })
  if (q) {
    filters.push(
      { content: { contains: q } },
      { subtype: { contains: q } },
      { sub2: { contains: q } },
      { skillTags: { contains: q } },
      { srcExamSession: { contains: q } },
      { srcOrigin: { contains: q } },
      { srcQuestionNo: { contains: q } },
      { analysis: { contains: q } },
      { sharedAiAnalysis: { contains: q } },
    )
  }
  if (filters.length) where.OR = filters

  const questions = await prisma.question.findMany({
    where,
    select: {
      id: true,
      content: true,
      type: true,
      subtype: true,
      sub2: true,
      skillTags: true,
      answer: true,
      options: true,
      analysis: true,
      questionImage: true,
      sharedAiAnalysis: true,
      examType: true,
      srcYear: true,
      srcProvince: true,
      srcExamSession: true,
      srcOrigin: true,
      srcQuestionNo: true,
    },
    orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    take: 50,
  })

  const scored = questions.map(question => {
    const haystack = [
      question.content,
      question.type,
      question.subtype,
      question.sub2,
      question.skillTags,
      question.analysis,
      question.sharedAiAnalysis,
      question.srcExamSession,
      question.srcProvince,
      question.srcYear,
      question.srcOrigin,
      question.srcQuestionNo,
    ].filter(Boolean).join(' ').toLowerCase()

    let score = 0
    const weightMatch = (value: string, weight: number) => {
      if (!value) return
      if (haystack.includes(value.toLowerCase())) score += weight
    }

    weightMatch(type, 4)
    weightMatch(module2, 3)
    weightMatch(module3, 3)
    weightMatch(skillTag, 4)
    weightMatch(srcExamSession, 3)
    weightMatch(srcProvince, 2)
    weightMatch(srcYear, 2)
    weightMatch(examType, 2)
    weightMatch(source, 2)
    weightMatch(q, 5)

    if (question.type === type) score += 4
    if (question.srcYear === srcYear && srcYear) score += 2
    if (question.srcProvince === srcProvince && srcProvince) score += 2
    if (question.examType === examType && examType) score += 2
    if (question.srcExamSession === srcExamSession && srcExamSession) score += 3

    return { question, score }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const createdA = a.question.srcYear ?? ''
    const createdB = b.question.srcYear ?? ''
    if (createdB !== createdA) return createdB.localeCompare(createdA)
    return a.question.id.localeCompare(b.question.id)
  })

  return NextResponse.json(scored.slice(0, limit).map(item => item.question))
}
