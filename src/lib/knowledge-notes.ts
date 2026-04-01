import { prisma } from '@/lib/prisma'
import { normalizeText, resolveKnowledgeNode } from '@/lib/knowledge-tree'

const db = prisma as any

function mergeSourceIds(existing: string | null | undefined, incoming: string | null | undefined) {
  const ids = new Set(
    [existing, incoming]
      .flatMap(value => normalizeText(value).split(','))
      .map(item => item.trim())
      .filter(Boolean)
  )

  return Array.from(ids).join(', ')
}

function inferKnowledgeTitle(params: {
  subtype?: string | null
  sub2?: string | null
  skillTags?: string | null
  content: string
  knowledgeTitle?: string | null
}) {
  const explicit = normalizeText(params.knowledgeTitle)
  if (explicit) return explicit

  const sub2 = normalizeText(params.sub2)
  if (sub2) return sub2

  const skillTag = normalizeText(params.skillTags?.split(/[，,]/)[0] ?? '')
  if (skillTag) return skillTag

  const subtype = normalizeText(params.subtype)
  if (subtype) return subtype

  const sentence = normalizeText(params.content)
    .split(/[。！？；\n]/)
    .map(part => part.trim())
    .find(Boolean)

  return sentence?.slice(0, 24) || '待整理知识点'
}

function buildInsightNoteContent(params: {
  body: string
  examples?: string | null
  sourceIds?: string | null
  insightType?: string | null
}) {
  return [
    `规则摘要：${normalizeText(params.body)}`,
    params.examples ? `典型例子：${normalizeText(params.examples)}` : '',
    params.sourceIds ? `来源错题：${normalizeText(params.sourceIds)}` : '',
    params.insightType ? `内容类型：${normalizeText(params.insightType)}` : '',
  ].filter(Boolean).join('\n\n')
}

export async function attachErrorToKnowledgeNote(params: {
  userId: string
  userErrorId: string
  question: {
    type: string
    subtype?: string | null
    sub2?: string | null
    skillTags?: string | null
    content: string
  }
  knowledgeTitle?: string | null
  summary?: string | null
  noteSource?: string
  sourceErrorIds?: string | null
}) {
  const title = inferKnowledgeTitle({
    subtype: params.question.subtype,
    sub2: params.question.sub2,
    skillTags: params.question.skillTags,
    content: params.question.content,
    knowledgeTitle: params.knowledgeTitle,
  })
  const node = await resolveKnowledgeNode(params.userId, {
    type: normalizeText(params.question.type),
    module2: normalizeText(params.question.subtype),
    module3: normalizeText(params.question.sub2),
    title,
    mode: 'system',
  })
  const subtype = normalizeText(params.noteSource ?? '错题复盘')
  const incomingSourceIds = normalizeText(params.sourceErrorIds) || params.userErrorId
  const content = normalizeText(params.summary) || `题目：${params.question.content.slice(0, 180)}`

  const existing = await db.userNote.findFirst({
    where: {
      userId: params.userId,
      knowledgeNodeId: node.id,
      title,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (existing) {
    return db.userNote.update({
      where: { id: existing.id },
      data: {
        subtype,
        sourceErrorIds: mergeSourceIds(existing.sourceErrorIds, incomingSourceIds),
        content: existing.content || content,
      },
    })
  }

  return db.userNote.create({
    data: {
      userId: params.userId,
      knowledgeNodeId: node.id,
      type: normalizeText(params.question.type) || '未分类',
      subtype,
      module2: normalizeText(params.question.subtype) || null,
      module3: normalizeText(params.question.sub2) || null,
      title,
      content,
      sourceErrorIds: incomingSourceIds,
      isPrivate: false,
    },
  })
}

export async function upsertKnowledgeNoteFromInsight(params: {
  userId: string
  skillTag: string
  insightType: string
  finalContent: string
  aiDraft?: string
  sourceErrorIds?: string
  domainExamples?: string
}) {
  const title = normalizeText(params.skillTag) || '待整理规则'
  const node = await resolveKnowledgeNode(params.userId, {
    title,
    mode: 'system',
  })
  const subtype = '规则沉淀'
  const content = buildInsightNoteContent({
    body: normalizeText(params.finalContent) || normalizeText(params.aiDraft) || `${title} 的规则摘要`,
    examples: params.domainExamples,
    sourceIds: params.sourceErrorIds,
    insightType: params.insightType,
  })

  const existing = await db.userNote.findFirst({
    where: {
      userId: params.userId,
      knowledgeNodeId: node.id,
      title,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (existing) {
    return db.userNote.update({
      where: { id: existing.id },
      data: {
        subtype,
        content: existing.content || content,
        sourceErrorIds: mergeSourceIds(existing.sourceErrorIds, params.sourceErrorIds),
        isPrivate: false,
      },
    })
  }

  return db.userNote.create({
    data: {
      userId: params.userId,
      knowledgeNodeId: node.id,
      type: '未分类',
      subtype,
      module2: null,
      module3: null,
      title,
      content,
      sourceErrorIds: normalizeText(params.sourceErrorIds) || null,
      isPrivate: false,
    },
  })
}
