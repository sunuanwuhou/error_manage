import { prisma } from '@/lib/prisma'
import { getAIConfig } from '@/lib/ai/provider'
import { processKnowledgeEntry } from '@/lib/ai/knowledge-extractor'

export type KnowledgeVisibility = 'private' | 'public' | 'off'

function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function splitKeywords(input: string) {
  return Array.from(new Set(
    input
      .split(/[，,、/\s]/)
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 6)
  ))
}

function buildFallbackSteps(content: string) {
  return content
    .split(/[。；;\n]/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 3)
}

async function upsertFallbackKnowledgeEntry(params: {
  userId: string
  isPublic: boolean
  questionType: string
  methodName: string
  rawContent: string
  rawAnalysis: string
  triggerKeywords: string[]
  solutionSteps: string[]
  exampleSolution: string
  qualityScore: number
}) {
  const existing = await prisma.knowledgeEntry.findFirst({
    where: {
      userId: params.userId,
      isPublic: params.isPublic,
      questionType: params.questionType,
      methodName: params.methodName,
    },
  })

  const data = {
    userId: params.userId,
    isPublic: params.isPublic,
    rawContent: params.rawContent,
    rawAnalysis: params.rawAnalysis,
    questionType: params.questionType,
    methodName: params.methodName,
    applicableTypes: JSON.stringify([params.questionType]),
    triggerKeywords: JSON.stringify(params.triggerKeywords),
    solutionSteps: JSON.stringify(params.solutionSteps),
    exampleSolution: params.exampleSolution,
    qualityScore: params.qualityScore,
    aiExtractedAt: new Date(),
  }

  if (existing) {
    return prisma.knowledgeEntry.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.knowledgeEntry.create({ data })
}

export async function queueKnowledgeEvolutionStrategyRefresh(params: {
  userId: string
  reason: string
}) {
  const recentPending = await prisma.analysisQueue.findFirst({
    where: {
      userId: params.userId,
      targetType: 'user_strategy_refresh',
      targetId: params.userId,
      status: 'pending',
      createdAt: {
        gte: new Date(Date.now() - 6 * 60 * 60 * 1000),
      },
    },
  })

  if (recentPending) return recentPending

  return prisma.analysisQueue.create({
    data: {
      userId: params.userId,
      triggeredBy: 'knowledge_evolution',
      targetType: 'user_strategy_refresh',
      targetId: params.userId,
      targetMeta: JSON.stringify({ reason: params.reason }),
      priority: 0.72,
      status: 'pending',
    },
  })
}

export async function evolveKnowledgeFromText(params: {
  userId: string
  title: string
  content: string
  questionType: string
  visibility?: KnowledgeVisibility
  sourceErrorIds?: string
  examples?: string
}) {
  const visibility = params.visibility ?? 'private'
  if (visibility === 'off') return null

  const title = normalizeText(params.title)
  const content = normalizeText(params.content)
  if (!title || !content) return null

  const isPublic = visibility === 'public'
  const analysisContent = [
    content,
    params.examples ? `例子：${normalizeText(params.examples)}` : '',
    params.sourceErrorIds ? `来源错题：${normalizeText(params.sourceErrorIds)}` : '',
  ].filter(Boolean).join('\n\n')

  const aiConfig = getAIConfig()
  try {
    if (aiConfig.hasAnthropicKey || aiConfig.hasMiniMaxKey) {
      const result = await processKnowledgeEntry(
        params.userId,
        title,
        analysisContent,
        params.questionType,
        undefined,
        isPublic
      )
      await queueKnowledgeEvolutionStrategyRefresh({
        userId: params.userId,
        reason: `knowledge_evolution:${params.questionType}`,
      })
      return result
    }
  } catch {
  }

  const fallback = await upsertFallbackKnowledgeEntry({
    userId: params.userId,
    isPublic,
    questionType: params.questionType,
    methodName: title,
    rawContent: title,
    rawAnalysis: analysisContent,
    triggerKeywords: splitKeywords(`${title} ${params.questionType}`),
    solutionSteps: buildFallbackSteps(content),
    exampleSolution: normalizeText(params.examples) || content.slice(0, 120),
    qualityScore: isPublic ? 0.7 : 0.6,
  })

  await queueKnowledgeEvolutionStrategyRefresh({
    userId: params.userId,
    reason: `knowledge_evolution:${params.questionType}`,
  })

  return {
    id: fallback.id,
    pattern: null,
    degraded: true,
  }
}
