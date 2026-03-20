// src/app/api/notes/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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
})

function normalizeComparableText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
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
  const notes = await prisma.userNote.findMany({
    where: { userId }, orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(notes)
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

  const note = await prisma.userNote.create({
    data: {
      userId,
      ...parsed.data,
      title: normalizedTitle,
      content: normalizedContent,
      subtype: normalizedSubtype,
      module2: normalizedModule2,
      module3: normalizedModule3,
      sourceErrorIds: normalizedSourceErrorIds,
    },
  })
  return NextResponse.json(note, { status: 201 })
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
