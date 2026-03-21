// src/app/api/insights/route.ts — 规律固化 CRUD（B4）
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { upsertKnowledgeNoteFromInsight } from '@/lib/knowledge-notes'
import { evolveKnowledgeFromText } from '@/lib/knowledge-evolution'
import { z } from 'zod'

const schema = z.object({
  skillTag:       z.string().min(1),
  insightType:    z.enum(['rule', 'trap', 'formula']).default('rule'),
  aiDraft:        z.string().default(''),
  finalContent:   z.string().min(1),
  sourceErrorIds: z.string().default(''),
  domainExamples: z.string().default(''),
  knowledgeVisibility: z.enum(['private', 'public', 'off']).default('private'),
})

function normalizeComparableText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

const systemInsightUpdateSchema = z.object({
  kind: z.literal('system'),
  id: z.string().min(1),
  status: z.enum(['applied', 'rejected']),
  rejectionReason: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const { searchParams } = new URL(req.url)
  const kind = searchParams.get('kind')

  if (kind === 'system') {
    const snapshotId = searchParams.get('snapshotId')
    const insights = await prisma.systemInsight.findMany({
      where: {
        OR: [{ userId }, { userId: null }],
        ...(snapshotId ? { sourceSnapshotId: snapshotId } : {}),
      },
      orderBy: [
        { status: 'asc' },
        { confidence: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        sourceSnapshotId: true,
        insightCategory: true,
        targetEntity: true,
        targetValue: true,
        paramKey: true,
        paramValueOld: true,
        paramValueNew: true,
        status: true,
        appliedAt: true,
        appliedBy: true,
        rejectionReason: true,
        confidence: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json(insights)
  }

  const insights = await prisma.userInsight.findMany({
    where: { userId, isActive: true }, orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(insights)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })

  const normalizedSkillTag = normalizeComparableText(parsed.data.skillTag)
  const normalizedFinalContent = normalizeComparableText(parsed.data.finalContent)
  const normalizedSourceErrorIds = normalizeComparableText(parsed.data.sourceErrorIds)
  const normalizedDomainExamples = normalizeComparableText(parsed.data.domainExamples)

  const existing = await prisma.userInsight.findMany({
    where: {
      userId,
      insightType: parsed.data.insightType,
      isActive: true,
    },
    select: {
      id: true,
      skillTag: true,
      finalContent: true,
      sourceErrorIds: true,
      domainExamples: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  const duplicate = existing.find(item => {
    const sameSkillTag = normalizeComparableText(item.skillTag) === normalizedSkillTag
    const sameFinalContent = normalizeComparableText(item.finalContent) === normalizedFinalContent
    const sameSourceErrorIds = normalizeComparableText(item.sourceErrorIds ?? '') === normalizedSourceErrorIds
    const sameDomainExamples = normalizeComparableText(item.domainExamples ?? '') === normalizedDomainExamples
    return sameSkillTag && (sameFinalContent || (sameSourceErrorIds && sameDomainExamples))
  })

  const knowledgeNote = await upsertKnowledgeNoteFromInsight({
    userId,
    skillTag: normalizedSkillTag || duplicate?.skillTag || normalizedSkillTag,
    insightType: parsed.data.insightType,
    finalContent: normalizedFinalContent,
    aiDraft: normalizeComparableText(parsed.data.aiDraft),
    sourceErrorIds: normalizedSourceErrorIds,
    domainExamples: normalizedDomainExamples,
  })

  const evolvedKnowledge = await evolveKnowledgeFromText({
    userId,
    title: normalizedSkillTag || '规律沉淀',
    content: normalizedFinalContent,
    questionType: '规律复盘',
    visibility: parsed.data.knowledgeVisibility,
    sourceErrorIds: normalizedSourceErrorIds,
    examples: normalizedDomainExamples,
  })

  if (duplicate) {
    return NextResponse.json({
      ...duplicate,
      deduped: true,
      knowledgeNoteId: knowledgeNote.id,
      knowledgeEntryId: evolvedKnowledge?.id ?? null,
    })
  }

  const { knowledgeVisibility: _knowledgeVisibility, ...insightData } = parsed.data

  const insight = await prisma.userInsight.create({
    data: {
      userId,
      ...insightData,
      skillTag: normalizedSkillTag,
      finalContent: normalizedFinalContent,
      sourceErrorIds: normalizedSourceErrorIds,
      domainExamples: normalizedDomainExamples,
    },
  })

  return NextResponse.json({
    ...insight,
    knowledgeNoteId: knowledgeNote.id,
    knowledgeEntryId: evolvedKnowledge?.id ?? null,
  }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const body = await req.json()

  const systemUpdate = systemInsightUpdateSchema.safeParse(body)
  if (systemUpdate.success) {
    const existing = await prisma.systemInsight.findFirst({
      where: {
        id: systemUpdate.data.id,
        OR: [{ userId }, { userId: null }],
      },
    })
    if (!existing) return NextResponse.json({ error: '系统建议不存在' }, { status: 404 })

    const updated = await prisma.systemInsight.update({
      where: { id: existing.id },
      data: {
        status: systemUpdate.data.status,
        appliedAt: systemUpdate.data.status === 'applied' ? new Date() : null,
        appliedBy: systemUpdate.data.status === 'applied' ? userId : null,
        rejectionReason: systemUpdate.data.status === 'rejected'
          ? (systemUpdate.data.rejectionReason?.trim() || '用户手动拒绝')
          : null,
      },
    })

    if (updated.sourceSnapshotId) {
      const remainingPending = await prisma.systemInsight.count({
        where: {
          sourceSnapshotId: updated.sourceSnapshotId,
          status: 'pending',
        },
      })

      await prisma.analysisSnapshot.update({
        where: { id: updated.sourceSnapshotId },
        data: {
          wasActedUpon: updated.status === 'applied' || remainingPending === 0,
          validationResult: updated.status === 'applied'
            ? `Applied ${updated.paramKey}`
            : `Rejected ${updated.paramKey}`,
          validatedAt: new Date(),
        },
      }).catch(() => {})
    }

    return NextResponse.json(updated)
  }

  const { id, ...data } = body
  const existing = await prisma.userInsight.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: '不存在' }, { status: 404 })
  const updated = await prisma.userInsight.update({ where: { id }, data })
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

  const existing = await prisma.userInsight.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: '不存在' }, { status: 404 })

  await prisma.userInsight.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
