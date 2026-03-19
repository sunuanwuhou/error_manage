import { prisma } from '@/lib/prisma'

const PROVINCES = [
  '北京', '天津', '上海', '重庆', '河北', '河南', '云南', '辽宁', '黑龙江', '湖南',
  '安徽', '山东', '新疆', '江苏', '浙江', '江西', '湖北', '广西', '甘肃', '山西',
  '内蒙古', '陕西', '吉林', '福建', '贵州', '广东', '青海', '西藏', '四川', '宁夏',
  '海南',
]

export interface PaperMeta {
  srcExamSession: string | null
  srcYear: string | null
  examType: string
  srcProvince: string | null
}

export interface PaperListItem extends PaperMeta {
  key: string
  title: string
  session: string | null
  questionCount: number
}

export interface PaperQuestionItem {
  userErrorId: null
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
  total: number
  typeBreakdown: Record<string, number>
  items: PaperQuestionItem[]
  error: string | null
}

export function inferPaperYear(srcExamSession: string | null, srcYear: string | null) {
  if (srcYear) return srcYear
  const match = srcExamSession?.match(/(20\d{2})/)
  return match?.[1] ?? null
}

export function inferPaperProvince(srcExamSession: string | null, srcProvince: string | null) {
  if (srcProvince) return srcProvince
  return PROVINCES.find(name => srcExamSession?.includes(name)) ?? null
}

export function inferPaperQuestionOrder(srcQuestionNo: string | null) {
  if (!srcQuestionNo) return null
  const cleaned = srcQuestionNo.trim()
  if (!cleaned) return null

  const exactMatch = cleaned.match(/^\d+$/)
  if (exactMatch) return Number(exactMatch[0])

  const digitMatch = cleaned.match(/\d+/)
  if (!digitMatch) return null

  const parsed = Number(digitMatch[0])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function buildPaperKey(row: PaperMeta) {
  if (row.srcExamSession) return `session:${row.srcExamSession}`
  return `auto:${row.srcYear ?? ''}|${row.examType}|${row.srcProvince ?? ''}`
}

export function buildPaperTitle(row: PaperMeta) {
  const year = inferPaperYear(row.srcExamSession, row.srcYear)
  const province = inferPaperProvince(row.srcExamSession, row.srcProvince)

  if (row.srcExamSession) {
    return row.srcExamSession
      .replace(/\.pdf$|\.docx$|\.xlsx$|\.xls$|\.csv$/i, '')
      .trim()
  }

  const typeLabel =
    row.examType === 'guo_kao' ? '国考' :
    row.examType === 'sheng_kao' ? '省考' :
    row.examType === 'tong_kao' ? '统考' :
    '通用'

  return [year, province, typeLabel, '导入真题']
    .filter(Boolean)
    .join(' ')
}

function toPaperMeta(row: {
  srcExamSession: string | null
  srcYear: string | null
  examType: string
  srcProvince: string | null
}): PaperMeta {
  return {
    srcExamSession: row.srcExamSession,
    srcYear: inferPaperYear(row.srcExamSession, row.srcYear),
    examType: row.examType,
    srcProvince: inferPaperProvince(row.srcExamSession, row.srcProvince),
  }
}

function buildPaperFacet(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

type PaperQuestionSortCandidate = {
  srcQuestionOrder: number | null
  srcQuestionNo: string | null
  createdAt?: Date | string | null
  id?: string | null
}

function resolvePaperQuestionOrder(question: PaperQuestionSortCandidate) {
  if (typeof question.srcQuestionOrder === 'number' && Number.isFinite(question.srcQuestionOrder) && question.srcQuestionOrder > 0) {
    return question.srcQuestionOrder
  }

  return inferPaperQuestionOrder(question.srcQuestionNo)
}

export function sortPaperQuestions<T extends PaperQuestionSortCandidate>(questions: T[]) {
  return [...questions].sort((a, b) => {
    const orderA = resolvePaperQuestionOrder(a)
    const orderB = resolvePaperQuestionOrder(b)

    if (orderA != null && orderB != null && orderA !== orderB) {
      return orderA - orderB
    }
    if (orderA != null && orderB == null) return -1
    if (orderA == null && orderB != null) return 1

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
    const rows = await prisma.question.groupBy({
      by: ['srcExamSession', 'srcYear', 'examType', 'srcProvince'],
      where: {
        isPublic: true,
        isFromOfficialBank: true,
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    })

    const mapped = rows.map(row => {
      const meta = toPaperMeta(row)
      return {
        ...meta,
        key: buildPaperKey(meta),
        title: buildPaperTitle(meta),
        session: row.srcExamSession,
        questionCount: row._count.id,
      }
    })

    const papers = mapped.filter(paper =>
      (!filters.examType || paper.examType === filters.examType) &&
      (!filters.province || paper.srcProvince === filters.province) &&
      (!filters.year || paper.srcYear === filters.year)
    )

    return {
      papers,
      examTypes: buildPaperFacet(mapped.map(paper => paper.examType)),
      provinces: buildPaperFacet(mapped.map(paper => paper.srcProvince)),
      years: buildPaperFacet(mapped.map(paper => paper.srcYear)).sort((a, b) => Number(b) - Number(a)),
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

function parsePaperKey(paperKey: string): PaperMeta | null {
  if (paperKey.startsWith('session:')) {
    const srcExamSession = paperKey.slice('session:'.length)
    if (!srcExamSession) return null
    return {
      srcExamSession,
      srcYear: null,
      examType: 'common',
      srcProvince: null,
    }
  }

  if (!paperKey.startsWith('auto:')) return null
  const [srcYear = '', examType = 'common', srcProvince = ''] = paperKey.slice('auto:'.length).split('|')
  if (!srcYear && examType === 'common' && !srcProvince) return null
  return {
    srcExamSession: null,
    srcYear: srcYear || null,
    examType: examType || 'common',
    srcProvince: srcProvince || null,
  }
}

export async function getPaperDetail(paperKey: string): Promise<PaperDetailResult> {
  const meta = parsePaperKey(paperKey)
  if (!meta) {
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
      error: '套卷标识无效',
    }
  }

  try {
    const questions = await prisma.question.findMany({
      where: {
        isPublic: true,
        isFromOfficialBank: true,
        ...(meta.srcExamSession
          ? { srcExamSession: meta.srcExamSession }
          : {
              srcExamSession: null,
              srcYear: meta.srcYear,
              examType: meta.examType,
              srcProvince: meta.srcProvince,
            }),
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
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    })
    const orderedQuestions = sortPaperQuestions(questions)

    const titleMeta = orderedQuestions[0]
      ? {
          srcExamSession: orderedQuestions[0].srcExamSession,
          srcYear: orderedQuestions[0].srcYear,
          examType: orderedQuestions[0].examType,
          srcProvince: orderedQuestions[0].srcProvince,
        }
      : meta

    return {
      key: paperKey,
      title: buildPaperTitle(titleMeta),
      srcYear: inferPaperYear(titleMeta.srcExamSession, titleMeta.srcYear),
      srcProvince: inferPaperProvince(titleMeta.srcExamSession, titleMeta.srcProvince),
      examType: titleMeta.examType,
      srcExamSession: titleMeta.srcExamSession,
      total: orderedQuestions.length,
      typeBreakdown: orderedQuestions.reduce<Record<string, number>>((acc, question) => {
        acc[question.type] = (acc[question.type] ?? 0) + 1
        return acc
      }, {}),
      items: orderedQuestions.map(q => ({
        userErrorId: null,
        questionId: q.id,
        masteryPercent: 0,
        reviewCount: 0,
        questionType: q.type,
        isHot: false,
        aiActionRule: null,
        aiThinking: null,
        aiRootReason: null,
        aiReasonTag: null,
        source: 'practice' as const,
        question: q,
      })),
      error: orderedQuestions.length > 0 ? null : '未找到对应套卷',
    }
  } catch (error: any) {
    return {
      key: paperKey,
      title: buildPaperTitle(meta),
      srcYear: inferPaperYear(meta.srcExamSession, meta.srcYear),
      srcProvince: inferPaperProvince(meta.srcExamSession, meta.srcProvince),
      examType: meta.examType,
      srcExamSession: meta.srcExamSession,
      total: 0,
      typeBreakdown: {},
      items: [],
      error: error?.message ?? '套卷详情加载失败',
    }
  }
}
