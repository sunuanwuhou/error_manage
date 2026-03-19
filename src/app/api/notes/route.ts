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
  isPrivate: z.boolean().default(false),
})

function normalizeComparableText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function isKnowledgePointDuplicate(note: { title: string; content: string; subtype: string | null }, target: {
  title: string
  content: string
  subtype: string
}) {
  const sameSubtype = normalizeComparableText(note.subtype ?? '') === target.subtype
  const sameTitle = normalizeComparableText(note.title) === target.title
  const sameContent = normalizeComparableText(note.content) === target.content
  return sameSubtype && (sameTitle || sameContent)
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
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  const duplicate = existing.find(note => isKnowledgePointDuplicate(note, {
    title: normalizedTitle,
    content: normalizedContent,
    subtype: normalizedSubtype,
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
  const updated = await prisma.userNote.update({ where: { id }, data })
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
