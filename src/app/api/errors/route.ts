// src/app/api/errors/route.ts
// 错题 CRUD

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// GET /api/errors — 获取错题列表
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const type     = searchParams.get('type')
  const q        = searchParams.get('q')
  const status   = searchParams.get('status')   // stockified | active
  const page     = parseInt(searchParams.get('page') ?? '1')
  const pageSize = 20

  const where: any = { userId }
  if (type || q) {
    where.question = {}
    if (type) where.question.type = type
    if (q)    where.question.content = { contains: q, mode: 'insensitive' }
  }
  if (status === 'stockified')   where.isStockified = true
  if (status === 'active')       where.isStockified = false

  const [items, total] = await Promise.all([
    prisma.userError.findMany({
      where,
      include: {
        question: {
          select: { id: true, content: true, type: true, subtype: true, answer: true, options: true, questionImage: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.userError.count({ where }),
  ])

  return NextResponse.json({ items, total, page, pageSize })
}

// POST /api/errors — 手动录题（题目+错题本一起创建）
const manualCreateSchema = z.object({
  content:     z.string().min(1),
  options:     z.array(z.string()).min(2),
  answer:      z.string().min(1),
  analysis:    z.string().optional(),
  questionImage: z.string().optional(),
  type:        z.string().min(1),
  subtype:     z.string().optional(),
  sub2:        z.string().optional(),
  myAnswer:    z.string().min(1),
  errorReason: z.string().optional(),
  examType:    z.string().default('common'),
  srcYear:     z.string().optional(),
  srcProvince: z.string().optional(),
  srcOrigin:   z.string().optional(),
})

const fromBankSchema = z.object({
  questionId:  z.string().min(1),
  myAnswer:    z.string().min(1),
  errorReason: z.string().optional(),
  fromSearch:  z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const body   = await req.json()
  const fromBank = fromBankSchema.safeParse(body)

  let question
  let myAnswer = ''
  let errorReason: string | undefined

  if (fromBank.success) {
    const d = fromBank.data
    question = await prisma.question.findUnique({
      where: { id: d.questionId },
    })
    if (!question) {
      return NextResponse.json({ error: '题目不存在' }, { status: 404 })
    }
    myAnswer = d.myAnswer
    errorReason = d.errorReason ?? (d.fromSearch ? '从题库加入错题本' : undefined)
  } else {
    const parsed = manualCreateSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

    const d = parsed.data
    myAnswer = d.myAnswer
    errorReason = d.errorReason

    const existing = await prisma.question.findFirst({
      where: { content: d.content },
    })

    question = existing

    if (!question) {
      question = await prisma.question.create({
        data: {
          addedBy:  userId,
          content:  d.content,
          questionImage: d.questionImage,
          options:  JSON.stringify(d.options),
          answer:   d.answer,
          analysis: d.analysis,
          type:     d.type,
          subtype:  d.subtype,
          sub2:     d.sub2,
          examType: d.examType,
          srcYear:      d.srcYear,
          srcProvince:  d.srcProvince,
          srcOrigin:    d.srcOrigin,
          isPublic: true,
        },
      })
    }
  }

  // 是否已在该用户错题本
  const existingError = await prisma.userError.findUnique({
    where: { userId_questionId: { userId, questionId: question.id } },
  })

  if (existingError) {
    return NextResponse.json({ error: '该题目已在你的错题本中', userErrorId: existingError.id }, { status: 409 })
  }

  const userError = await prisma.userError.create({
    data: {
      userId,
      questionId:  question.id,
      myAnswer,
      errorReason,
      masteryPercent: 0,
      reviewInterval: 1,
      nextReviewAt: new Date(),  // 立即可复习
    },
  })

  // 异步触发 AI 首次诊断（不阻塞响应）
  // 公共解析：第一个做错的用户触发，后续用户零成本复用（§3.2）
  import('@/lib/ai-diagnosis').then(({ triggerPostRecordDiagnosis }) => {
    triggerPostRecordDiagnosis(userError.id, question!.id).catch((err: Error) =>
      console.error('[AI诊断] 异步失败：', err.message)
    )
  })

  return NextResponse.json({ userErrorId: userError.id, questionId: question.id }, { status: 201 })
}
