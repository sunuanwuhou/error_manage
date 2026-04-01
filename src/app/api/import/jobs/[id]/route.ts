import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const patchSchema = z.object({
  parsedQuestions: z.array(z.object({
    index: z.number().int().optional(),
    no: z.string().optional(),
    content: z.string().optional(),
    questionImage: z.string().optional().nullable(),
    options: z.array(z.string()).optional(),
    answer: z.string().optional(),
    type: z.string().optional(),
    analysis: z.string().optional().nullable(),
    rawText: z.string().optional().nullable(),
    examType: z.string().optional().nullable(),
    srcName: z.string().optional().nullable(),
    srcOrigin: z.string().optional().nullable(),
    fileName: z.string().optional().nullable(),
    relativePath: z.string().optional().nullable(),
  })),
})

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const job = await prisma.importJob.findFirst({
    where: { id: params.id, userId },
  })
  if (!job) return NextResponse.json({ error: '导入任务不存在' }, { status: 404 })

  let parsedQuestions = []
  try {
    parsedQuestions = job.parsedQuestions ? JSON.parse(job.parsedQuestions) : []
  } catch {
    parsedQuestions = []
  }

  return NextResponse.json({ job: { ...job, parsedQuestions } })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })
  }

  const existed = await prisma.importJob.findFirst({
    where: { id: params.id, userId },
  })
  if (!existed) return NextResponse.json({ error: '导入任务不存在' }, { status: 404 })

  const updated = await prisma.importJob.update({
    where: { id: existed.id },
    data: {
      parsedQuestions: JSON.stringify(parsed.data.parsedQuestions || []),
      status: existed.status === 'parsed' ? 'reviewing' : existed.status,
    },
  })

  return NextResponse.json({ ok: true, job: updated })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const existed = await prisma.importJob.findFirst({
    where: { id: params.id, userId },
  })
  if (!existed) return NextResponse.json({ error: '导入任务不存在' }, { status: 404 })

  await prisma.importJob.delete({
    where: { id: existed.id },
  })

  return NextResponse.json({ ok: true })
}
