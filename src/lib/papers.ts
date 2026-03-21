import { prisma } from '@/lib/prisma'
import {
  buildCanonicalPaperSession,
  buildCanonicalPaperTitle,
  inferPaperExamType,
  inferPaperProvince as inferProvinceFromSource,
  inferPaperSourceMeta,
  inferPaperYear as inferYearFromSource,
} from '@/lib/paper-source'

export interface PaperMeta {
  srcExamSession: string | null
  srcYear: string | null
  examType: string
  srcProvince: string | null
}

export interface PaperListItem extends PaperMeta {
  key: string
  title: string
  sessionLabel: string | null
  session: string | null
  questionCount: number
}

export interface PaperQuestionItem {
  userErrorId: string | null
  questionId: string
  masteryPercent: number
  reviewCount: number
  questionType: string
  isHot: boolean
  aiActionRule: string | null
  aiThinking: string | null
  aiRootReason: string | null
  aiReasonTag: string | null
  source: 'practice'
  question: {
    id: string
    content: string
    questionImage: string | null
    options: string | null
    answer: string
    type: string
    subtype: string | null
    analysis: string | null
    sharedAiAnalysis: string | null
    sharedMemoryAnchor: string | null
    skillTags: string | null
    srcExamSession: string | null
    srcYear: string | null
    examType: string
    srcProvince: string | null
    srcQuestionNo: string | null
    srcQuestionOrder: number | null
    createdAt: Date
  }
}

export interface PaperCatalogResult {
  papers: PaperListItem[]
  examTypes: string[]
  provinces: string[]
  years: string[]
  error: string | null
}

export interface PaperDetailResult extends PaperMeta {
  key: string
  title: string
  sessionLabel?: string | null
  total: number
  typeBreakdown: Record<string, number>
  items: PaperQuestionItem[]
  error: string | null
}

type PaperRow = {
  srcExamSession: string | null
  srcYear: string | null
  examType: string
  srcProvince: string | null
}

type QuestionRow = {
  id: string
  content: string
  questionImage: string | null
  options: string | null
  answer: string
  type: string
  subtype: string | null
  analysis: string | null
  sharedAiAnalysis: string | null
  sharedMemoryAnchor: string | null
  skillTags: string | null
  srcExamSession: string | null
  srcYear: string | null
  examType: string
  srcProvince: string | null
  srcQuestionNo: string | null
  srcQuestionOrder: number | null
  createdAt: Date
}

type PaperIdentity = {
  key: string
  title: string
  sessionLabel: string | null
  srcExamSession: string | null
  srcYear: string | null
  examType: string
  srcProvince: string | null
}

export function inferPaperYear(srcExamSession: string | null, srcYear: string | null) {
  return srcYear || inferYearFromSource(srcExamSession) || null
}

export function inferPaperProvince(srcExamSession: string | null, srcProvince: string | null) {
  return srcProvince || inferProvinceFromSource(srcExamSession) || null
}

export function inferPaperQuestionOrder(srcQuestionNo: string | null) {
  if (!srcQuestionNo) return null
  const exact = srcQuestionNo.trim().match(/^\d+$/)
  if (exact) return Number(exact[0])
  const firstDigit = srcQuestionNo.match(/\d+/)
  return firstDigit ? Number(firstDigit[0]) : null
}

function buildPaperIdentity(row: PaperRow): PaperIdentity {
  const meta = inferPaperSourceMeta({
    srcName: row.srcExamSession ?? undefined,
  })
  const srcYear = inferPaperYear(row.srcExamSession, row.srcYear)
  const srcProvince = inferPaperProvince(row.srcExamSession, row.srcProvince)
  const examType = row.examType && row.examType !== 'common'
    ? row.examType
    : (meta.examType || inferPaperExamType(row.srcExamSession) || 'common')
  const sessionLabel = buildCanonicalPaperSession({
    srcExamSession: row.srcExamSession,
    srcYear,
    srcProvince,
    examType,
  })
  const title = buildCanonicalPaperTitle({
    srcExamSession: row.srcExamSession,
    srcYear,
    srcProvince,
    examType,
  })

  return {
    key: `paper:${sessionLabel || `${srcYear ?? ''}|${srcProvince ?? ''}|${examType}|${title}`}`,
    title,
    sessionLabel: sessionLabel || null,
    srcExamSession: row.srcExamSession,
    srcYear,
    examType,
    srcProvince,
  }
}

export function buildPaperKey(row: PaperMeta) {
  return buildPaperIdentity(row).key
}

export function buildPaperTitle(row: PaperMeta) {
  return buildPaperIdentity(row).title
}

function buildPaperFacet(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort()
}

type PaperQuestionSortCandidate = {
  srcQuestionOrder: number | null
  srcQuestionNo: string | null
  createdAt?: Date | string | null
  id?: string | null
}

function resolvePaperQuestionOrder(question: PaperQuestionSortCandidate) {
  if (typeof question.srcQuestionOrder === 'number' && question.srcQuestionOrder > 0) {
    return question.srcQuestionOrder
  }
  return inferPaperQuestionOrder(question.srcQuestionNo)
}

export function sortPaperQuestions<T extends PaperQuestionSortCandidate>(questions: T[]) {
  return [...questions].sort((a, b) => {
    const orderA = resolvePaperQuestionOrder(a)
    const orderB = resolvePaperQuestionOrder(b)
    if (orderA != null && orderB != null && orderA !== orderB) return orderA - orderB
    if (orderA != null) return -1
    if (orderB != null) return 1

    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    if (timeA !== timeB) return timeA - timeB

    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
}

export async function getPaperCatalog(filters: {
  examType?: string
  province?: string | null
  year?: string | null
} = {}): Promise<PaperCatalogResult> {
  try {
    const rows = await prisma.question.findMany({
      where: {
        isPublic: true,
        isFromOfficialBank: true,
      },
      select: {
        srcExamSession: true,
        srcYear: true,
        examType: true,
        srcProvince: true,
      },
    })

    const bucket = new Map<string, PaperListItem>()
    for (const row of rows) {
      const identity = buildPaperIdentity(row)
      const existing = bucket.get(identity.key)
      if (existing) {
        existing.questionCount += 1
        continue
      }
      bucket.set(identity.key, {
        ...identity,
        session: identity.sessionLabel,
        questionCount: 1,
      })
    }

    const mapped = Array.from(bucket.values()).sort((a, b) => {
      const yearA = Number(a.srcYear ?? 0)
      const yearB = Number(b.srcYear ?? 0)
      if (yearA !== yearB) return yearB - yearA
      return b.questionCount - a.questionCount
    })

    const papers = mapped.filter(item =>
      (!filters.examType || item.examType === filters.examType) &&
      (!filters.province || item.srcProvince === filters.province) &&
      (!filters.year || item.srcYear === filters.year)
    )

    return {
      papers,
      examTypes: buildPaperFacet(mapped.map(item => item.examType)),
      provinces: buildPaperFacet(mapped.map(item => item.srcProvince)),
      years: buildPaperFacet(mapped.map(item => item.srcYear)).sort((a, b) => Number(b) - Number(a)),
      error: null,
    }
  } catch (error: any) {
    return {
      papers: [],
      examTypes: [],
      provinces: [],
      years: [],
      error: error?.message ?? '套卷列表加载失败',
    }
  }
}

export async function getPaperDetail(paperKey: string, userId?: string): Promise<PaperDetailResult> {
  try {
    const questions = await prisma.question.findMany({
      where: {
        isPublic: true,
        isFromOfficialBank: true,
      },
      select: {
        id: true,
        content: true,
        questionImage: true,
        options: true,
        answer: true,
        type: true,
        subtype: true,
        analysis: true,
        sharedAiAnalysis: true,
        sharedMemoryAnchor: true,
        skillTags: true,
        srcExamSession: true,
        srcYear: true,
        examType: true,
        srcProvince: true,
        srcQuestionNo: true,
        srcQuestionOrder: true,
        createdAt: true,
      },
    })

    const matched = questions.filter(question => buildPaperIdentity(question).key === paperKey)
    const orderedQuestions = sortPaperQuestions(matched)
    const first = orderedQuestions[0]

    if (!first) {
      return {
        key: paperKey,
        title: '未找到对应套卷',
        srcExamSession: null,
        srcYear: null,
        examType: 'common',
        srcProvince: null,
        total: 0,
        typeBreakdown: {},
        items: [],
        error: '套卷不存在',
      }
    }

    const identity = buildPaperIdentity(first)

    const userErrors = userId && orderedQuestions.length > 0
      ? await prisma.userError.findMany({
          where: {
            userId,
            questionId: { in: orderedQuestions.map(question => question.id) },
          },
          select: {
            id: true,
            questionId: true,
            masteryPercent: true,
            reviewCount: true,
            isHot: true,
            aiActionRule: true,
            aiThinking: true,
            aiRootReason: true,
            aiReasonTag: true,
            customAiAnalysis: true,
          },
        })
      : []

    const userErrorMap = new Map(userErrors.map(item => [item.questionId, item]))

    return {
      key: identity.key,
      title: identity.title,
      sessionLabel: identity.sessionLabel,
      srcExamSession: identity.srcExamSession,
      srcYear: identity.srcYear,
      examType: identity.examType,
      srcProvince: identity.srcProvince,
      total: orderedQuestions.length,
      typeBreakdown: orderedQuestions.reduce<Record<string, number>>((acc, question) => {
        acc[question.type] = (acc[question.type] ?? 0) + 1
        return acc
      }, {}),
      items: orderedQuestions.map(question => {
        const userError = userErrorMap.get(question.id)
        return {
          userErrorId: userError?.id ?? null,
          questionId: question.id,
          masteryPercent: userError?.masteryPercent ?? 0,
          reviewCount: userError?.reviewCount ?? 0,
          questionType: question.type,
          isHot: userError?.isHot ?? false,
          aiActionRule: userError?.aiActionRule ?? null,
          aiThinking: userError?.aiThinking ?? null,
          aiRootReason: userError?.aiRootReason ?? null,
          aiReasonTag: userError?.aiReasonTag ?? null,
          source: 'practice' as const,
          question: {
            ...question,
            sharedAiAnalysis: userError?.customAiAnalysis || question.sharedAiAnalysis,
          },
        }
      }),
      error: null,
    }
  } catch (error: any) {
    return {
      key: paperKey,
      title: '套卷详情加载失败',
      sessionLabel: null,
      srcExamSession: null,
      srcYear: null,
      examType: 'common',
      srcProvince: null,
      total: 0,
      typeBreakdown: {},
      items: [],
      error: error?.message ?? '套卷详情加载失败',
    }
  }
}

async function rebuildExamTopicStatsForExamType(examType: string) {
  await prisma.examTopicStats.deleteMany({
    where: {
      examType,
      srcProvince: null,
    },
  })

  const allByType = await prisma.question.groupBy({
    by: ['type'],
    where: {
      examType,
      isFromOfficialBank: true,
    },
    _count: { id: true },
  })

  const total = allByType.reduce((sum, row) => sum + row._count.id, 0)
  if (total === 0) return

  await prisma.examTopicStats.createMany({
    data: allByType.map(row => ({
      examType,
      srcProvince: null,
      skillTag: row.type,
      sectionType: row.type,
      frequency: row._count.id / total,
      totalCount: row._count.id,
      avgDifficulty: 0.5,
      lastExamYear: null,
    })),
  })
}

export async function deletePaperByKey(paperKey: string) {
  const detail = await getPaperDetail(paperKey)
  if (detail.error || detail.items.length === 0) {
    return {
      deletedQuestions: 0,
      deletedUserErrors: 0,
      deletedPracticeRecords: 0,
      deletedPaperSessions: 0,
      deletedReviewRecords: 0,
      title: detail.title,
      error: detail.error || '套卷不存在',
    }
  }

  const questionIds = detail.items.map(item => item.questionId)
  const userErrors = await prisma.userError.findMany({
    where: {
      questionId: { in: questionIds },
    },
    select: {
      id: true,
    },
  })
  const userErrorIds = userErrors.map(item => item.id)

  const [reviewResult, practiceResult, userErrorResult, paperSessionResult, questionResult] = await prisma.$transaction([
    prisma.reviewRecord.deleteMany({
      where: {
        userErrorId: { in: userErrorIds.length > 0 ? userErrorIds : ['__none__'] },
      },
    }),
    prisma.practiceRecord.deleteMany({
      where: {
        questionId: { in: questionIds },
      },
    }),
    prisma.userError.deleteMany({
      where: {
        questionId: { in: questionIds },
      },
    }),
    prisma.paperPracticeSession.deleteMany({
      where: {
        paperKey,
      },
    }),
    prisma.question.deleteMany({
      where: {
        id: { in: questionIds },
      },
    }),
  ])

  await rebuildExamTopicStatsForExamType(detail.examType)

  return {
    deletedQuestions: questionResult.count,
    deletedUserErrors: userErrorResult.count,
    deletedPracticeRecords: practiceResult.count,
    deletedPaperSessions: paperSessionResult.count,
    deletedReviewRecords: reviewResult.count,
    title: detail.title,
    error: null,
  }
}
