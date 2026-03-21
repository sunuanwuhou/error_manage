// src/app/api/notes/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { evolveKnowledgeFromText } from '@/lib/knowledge-evolution'
import { z } from 'zod'

const schema = z.object({
  title:     z.string().min(1),
  content:   z.string().min(1),
  type:      z.string().default('通用'),
  subtype:   z.string().default(''),
  module2:   z.string().default(''),
  module3:   z.string().default(''),
  sourceErrorIds: z.string().default(''),
  isPrivate: z.boolean().default(false),
  knowledgeVisibility: z.enum(['private', 'public', 'off']).default('private'),
})

function normalizeComparableText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function splitSourceIds(value: string | null | undefined) {
  return normalizeComparableText(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function buildResolvedSourceErrorSummary(note: {
  sourceErrorIds?: string | null
}, userErrors: Array<{ id: string; questionId: string }>) {
  const rawIds = splitSourceIds(note.sourceErrorIds)
  if (rawIds.length === 0) {
    return {
      rawSourceErrorIds: [],
      resolvedSourceErrorIds: [],
      rawSourceErrorCount: 0,
      resolvedSourceErrorCount: 0,
      staleSourceErrorCount: 0,
    }
  }

  const errorIdSet = new Set(userErrors.map(item => item.id))
  const questionIdToErrorId = new Map(userErrors.map(item => [item.questionId, item.id]))
  const resolvedSourceErrorIds = Array.from(new Set(
    rawIds
      .map(id => (errorIdSet.has(id) ? id : (questionIdToErrorId.get(id) ?? '')))
      .filter(Boolean)
  ))

  return {
    rawSourceErrorIds: rawIds,
    resolvedSourceErrorIds,
    rawSourceErrorCount: rawIds.length,
    resolvedSourceErrorCount: resolvedSourceErrorIds.length,
    staleSourceErrorCount: Math.max(0, rawIds.length - resolvedSourceErrorIds.length),
  }
}

function isKnowledgePointDuplicate(note: {
  title: string
  content: string
  subtype: string | null
  module2: string | null
  module3: string | null
}, target: {
  title: string
  content: string
  subtype: string
  module2: string
  module3: string
}) {
  const sameSubtype = normalizeComparableText(note.subtype ?? '') === target.subtype
  const sameModule2 = normalizeComparableText(note.module2 ?? '') === target.module2
  const sameModule3 = normalizeComparableText(note.module3 ?? '') === target.module3
  const sameTitle = normalizeComparableText(note.title) === target.title
  const sameContent = normalizeComparableText(note.content) === target.content
  return sameSubtype && sameModule2 && sameModule3 && (sameTitle || sameContent)
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const [notes, userErrors] = await Promise.all([
    prisma.userNote.findMany({
      where: { userId }, orderBy: { updatedAt: 'desc' },
    }),
    prisma.userError.findMany({
      where: { userId },
      select: { id: true, questionId: true },
    }),
  ])

  return NextResponse.json(
    notes.map(note => ({
      ...note,
      ...buildResolvedSourceErrorSummary(note, userErrors),
    }))
  )
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })

  const normalizedTitle = normalizeComparableText(parsed.data.title)
  const normalizedContent = normalizeComparableText(parsed.data.content)
  const normalizedSubtype = normalizeComparableText(parsed.data.subtype)
  const normalizedModule2 = normalizeComparableText(parsed.data.module2)
  const normalizedModule3 = normalizeComparableText(parsed.data.module3)
  const normalizedSourceErrorIds = normalizeComparableText(parsed.data.sourceErrorIds)

  const existing = await prisma.userNote.findMany({
    where: {
      userId,
      type: parsed.data.type,
      isPrivate: parsed.data.isPrivate,
    },
    select: {
      id: true,
      title: true,
      content: true,
      subtype: true,
      module2: true,
      module3: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  const duplicate = existing.find(note => isKnowledgePointDuplicate(note, {
    title: normalizedTitle,
    content: normalizedContent,
    subtype: normalizedSubtype,
    module2: normalizedModule2,
    module3: normalizedModule3,
  }))

  if (duplicate) {
    return NextResponse.json({ ...duplicate, deduped: true })
  }

  const { knowledgeVisibility: _knowledgeVisibility, ...noteData } = parsed.data

  const note = await prisma.userNote.create({
    data: {
      userId,
      ...noteData,
      title: normalizedTitle,
      content: normalizedContent,
      subtype: normalizedSubtype,
      module2: normalizedModule2,
      module3: normalizedModule3,
      sourceErrorIds: normalizedSourceErrorIds,
    },
  })

  const evolvedKnowledge = await evolveKnowledgeFromText({
    userId,
    title: normalizedTitle,
    content: normalizedContent,
    questionType: normalizedSubtype || parsed.data.type || '心得体会',
    visibility: parsed.data.knowledgeVisibility,
    sourceErrorIds: normalizedSourceErrorIds,
  })
  return NextResponse.json({
    ...note,
    knowledgeEntryId: evolvedKnowledge?.id ?? null,
  }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const body = await req.json()
  const { id, ...data } = body
  const note = await prisma.userNote.findFirst({ where: { id, userId } })
  if (!note) return NextResponse.json({ error: '不存在' }, { status: 404 })
  const normalizedData = {
    ...data,
    ...(typeof data.title === 'string' ? { title: normalizeComparableText(data.title) } : {}),
    ...(typeof data.content === 'string' ? { content: normalizeComparableText(data.content) } : {}),
    ...(typeof data.subtype === 'string' ? { subtype: normalizeComparableText(data.subtype) } : {}),
    ...(typeof data.module2 === 'string' ? { module2: normalizeComparableText(data.module2) } : {}),
    ...(typeof data.module3 === 'string' ? { module3: normalizeComparableText(data.module3) } : {}),
    ...(typeof data.sourceErrorIds === 'string' ? { sourceErrorIds: normalizeComparableText(data.sourceErrorIds) } : {}),
  }
  const updated = await prisma.userNote.update({ where: { id }, data: normalizedData })
  return NextResponse.json(updated)
}

export async function PATCH(req: NextRequest) {
  return PUT(req)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少id' }, { status: 400 })
  const note = await prisma.userNote.findFirst({ where: { id, userId } })
  if (!note) return NextResponse.json({ error: '不存在' }, { status: 404 })
  await prisma.userNote.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
