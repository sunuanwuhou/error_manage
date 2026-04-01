import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import {
  backfillNoteKnowledgeNode,
  buildKnowledgeTree,
  buildNodeOptions,
  DEFAULT_KNOWLEDGE_LIBRARY_TEMPLATES,
  ensureKnowledgeRoots,
  normalizeText,
  resolveKnowledgeNode,
  seedKnowledgeLibraryFromTemplate,
} from '@/lib/knowledge-tree'
import { evolveKnowledgeFromText } from '@/lib/knowledge-evolution'
import { extractAssetIdsFromMarkdown } from '@/lib/note-assets'
import { prisma } from '@/lib/prisma'

const db = prisma as any

const schema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  type: z.string().default('未分类'),
  subtype: z.string().default(''),
  module2: z.string().default(''),
  module3: z.string().default(''),
  sourceErrorIds: z.string().default(''),
  isPrivate: z.boolean().default(false),
  knowledgeVisibility: z.enum(['private', 'public', 'off']).default('private'),
  knowledgeNodeId: z.string().optional(),
})

function splitSourceIds(value: string | null | undefined) {
  return normalizeText(value)
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
  knowledgeNodeId: string | null
}, target: {
  title: string
  content: string
  subtype: string
  module2: string
  module3: string
  knowledgeNodeId: string | null
}) {
  return (
    normalizeText(note.title) === target.title &&
    normalizeText(note.content) === target.content &&
    normalizeText(note.subtype ?? '') === target.subtype &&
    normalizeText(note.module2 ?? '') === target.module2 &&
    normalizeText(note.module3 ?? '') === target.module3 &&
    (note.knowledgeNodeId ?? null) === target.knowledgeNodeId
  )
}

async function syncNoteAssets(userId: string, noteId: string, content: string) {
  const assetIds = extractAssetIdsFromMarkdown(content)

  await db.noteAsset.updateMany({
    where: {
      userId,
      noteId,
      ...(assetIds.length > 0 ? { id: { notIn: assetIds } } : {}),
    },
    data: { noteId: null },
  })

  if (assetIds.length === 0) return

  await db.noteAsset.updateMany({
    where: { userId, id: { in: assetIds } },
    data: { noteId },
  })
}

async function getUserId() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return (session.user as { id?: string }).id ?? null
}

async function buildNotesPayload(userId: string) {
  await ensureKnowledgeRoots(userId)

  const initialNotes = await db.userNote.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  })

  for (const note of initialNotes) {
    if (!note.knowledgeNodeId) {
      await backfillNoteKnowledgeNode(note)
    }
  }

  const [notes, userErrors, nodes] = await Promise.all([
    db.userNote.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        knowledgeNode: true,
        assets: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, altText: true, mimeType: true, dataUrl: true },
        },
      },
    }),
    db.userError.findMany({
      where: { userId },
      select: { id: true, questionId: true },
    }),
    db.knowledgeNode.findMany({
      where: { userId },
      include: { notes: { select: { id: true } } },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    }),
  ])

  return {
    notes: notes.map((note: any) => ({
      ...note,
      nodeId: note.knowledgeNodeId,
      nodeTitle: note.knowledgeNode?.title ?? '',
      ...buildResolvedSourceErrorSummary(note, userErrors),
    })),
    tree: buildKnowledgeTree(nodes),
    nodeOptions: buildNodeOptions(nodes.map((node: any) => ({
      id: node.id,
      userId: node.userId,
      parentId: node.parentId,
      nodeType: node.nodeType,
      title: node.title,
      source: node.source,
      sortOrder: node.sortOrder,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    }))),
    templates: DEFAULT_KNOWLEDGE_LIBRARY_TEMPLATES.map(template => ({
      key: template.key,
      title: template.title,
      description: template.description,
    })),
  }
}

export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const templateKey = new URL(req.url).searchParams.get('seedTemplate')
  if (templateKey) {
    await seedKnowledgeLibraryFromTemplate(userId, templateKey)
  }

  return NextResponse.json(await buildNotesPayload(userId))
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })

  const normalizedTitle = normalizeText(parsed.data.title)
  const normalizedContent = normalizeText(parsed.data.content)
  const normalizedSubtype = normalizeText(parsed.data.subtype)
  const normalizedModule2 = normalizeText(parsed.data.module2)
  const normalizedModule3 = normalizeText(parsed.data.module3)
  const normalizedSourceErrorIds = normalizeText(parsed.data.sourceErrorIds)
  const node = await resolveKnowledgeNode(userId, {
    knowledgeNodeId: parsed.data.knowledgeNodeId,
    type: normalizeText(parsed.data.type),
    module2: normalizedModule2,
    module3: normalizedModule3,
    title: normalizedTitle,
    mode: 'user',
  })

  const existing = await db.userNote.findMany({
    where: {
      userId,
      isPrivate: parsed.data.isPrivate,
      knowledgeNodeId: node.id,
    },
    select: {
      id: true,
      title: true,
      content: true,
      subtype: true,
      module2: true,
      module3: true,
      knowledgeNodeId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  const duplicate = existing.find((note: any) => isKnowledgePointDuplicate(note, {
    title: normalizedTitle,
    content: normalizedContent,
    subtype: normalizedSubtype,
    module2: normalizedModule2,
    module3: normalizedModule3,
    knowledgeNodeId: node.id,
  }))

  if (duplicate) {
    return NextResponse.json({ ...duplicate, deduped: true })
  }

  const note = await db.userNote.create({
    data: {
      userId,
      knowledgeNodeId: node.id,
      type: normalizeText(parsed.data.type) || '未分类',
      title: normalizedTitle,
      content: normalizedContent,
      subtype: normalizedSubtype,
      module2: normalizedModule2 || null,
      module3: normalizedModule3 || null,
      sourceErrorIds: normalizedSourceErrorIds || null,
      isPrivate: parsed.data.isPrivate,
    },
  })

  await syncNoteAssets(userId, note.id, normalizedContent)

  const evolvedKnowledge = await evolveKnowledgeFromText({
    userId,
    title: normalizedTitle,
    content: normalizedContent,
    questionType: normalizedSubtype || normalizeText(parsed.data.type) || '知识笔记',
    visibility: parsed.data.knowledgeVisibility,
    sourceErrorIds: normalizedSourceErrorIds,
  })

  return NextResponse.json({
    ...note,
    knowledgeEntryId: evolvedKnowledge?.id ?? null,
    knowledgeNodeId: node.id,
  }, { status: 201 })
}

async function updateNote(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = await req.json()
  const { id, ...data } = body as Record<string, unknown>
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const note = await db.userNote.findFirst({ where: { id, userId } })
  if (!note) return NextResponse.json({ error: '不存在' }, { status: 404 })

  const nextTitle = typeof data.title === 'string' ? normalizeText(data.title) : note.title
  const nextContent = typeof data.content === 'string' ? normalizeText(data.content) : note.content
  const nextType = typeof data.type === 'string' ? normalizeText(data.type) : note.type
  const nextModule2 = typeof data.module2 === 'string' ? normalizeText(data.module2) : (note.module2 ?? '')
  const nextModule3 = typeof data.module3 === 'string' ? normalizeText(data.module3) : (note.module3 ?? '')
  const nextNode = await resolveKnowledgeNode(userId, {
    knowledgeNodeId: typeof data.knowledgeNodeId === 'string' ? data.knowledgeNodeId : note.knowledgeNodeId,
    type: nextType,
    module2: nextModule2,
    module3: nextModule3,
    title: nextTitle,
    mode: 'user',
  })

  const updated = await db.userNote.update({
    where: { id },
    data: {
      ...(typeof data.title === 'string' ? { title: nextTitle } : {}),
      ...(typeof data.content === 'string' ? { content: nextContent } : {}),
      ...(typeof data.type === 'string' ? { type: nextType || '未分类' } : {}),
      ...(typeof data.subtype === 'string' ? { subtype: normalizeText(data.subtype) || null } : {}),
      ...(typeof data.module2 === 'string' ? { module2: nextModule2 || null } : {}),
      ...(typeof data.module3 === 'string' ? { module3: nextModule3 || null } : {}),
      ...(typeof data.sourceErrorIds === 'string' ? { sourceErrorIds: normalizeText(data.sourceErrorIds) || null } : {}),
      ...(typeof data.isPrivate === 'boolean' ? { isPrivate: data.isPrivate } : {}),
      knowledgeNodeId: nextNode.id,
    },
  })

  await syncNoteAssets(userId, id, nextContent)
  return NextResponse.json(updated)
}

export async function PUT(req: NextRequest) {
  return updateNote(req)
}

export async function PATCH(req: NextRequest) {
  return updateNote(req)
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const note = await db.userNote.findFirst({ where: { id, userId } })
  if (!note) return NextResponse.json({ error: '不存在' }, { status: 404 })

  await db.noteAsset.updateMany({
    where: { userId, noteId: id },
    data: { noteId: null },
  })
  await db.userNote.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
