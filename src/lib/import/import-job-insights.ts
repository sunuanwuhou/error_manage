import { evaluateImportQuality, inferQuestionType } from '@/lib/import/quality-gate'

export type ParsedImportQuestion = {
  index?: number
  no?: string
  content?: string
  questionImage?: string | null
  options?: string[]
  answer?: string
  type?: string
  analysis?: string | null
  rawText?: string | null
  fileName?: string | null
  relativePath?: string | null
}

export type ImportJobInsight = {
  total: number
  blockedCount: number
  warningCount: number
  readyCount: number
  blockerReasons: Array<{ label: string; count: number }>
  warningReasons: Array<{ label: string; count: number }>
  typeBreakdown: Record<string, number>
  fileBreakdown: Array<{
    key: string
    label: string
    total: number
    blockedCount: number
    warningCount: number
    readyCount: number
  }>
  recommendedPublishIndexes: number[]
}

function asArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : []
}

export function parseImportJobQuestions(raw: string | ParsedImportQuestion[] | null | undefined): ParsedImportQuestion[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function buildImportJobInsight(input: string | ParsedImportQuestion[] | null | undefined): ImportJobInsight {
  const questions = parseImportJobQuestions(input)
  const blockerMap: Record<string, number> = {}
  const warningMap: Record<string, number> = {}
  const typeBreakdown: Record<string, number> = {}
  const fileMap = new Map<string, { key: string; label: string; total: number; blockedCount: number; warningCount: number; readyCount: number }>()
  const recommendedPublishIndexes: number[] = []

  let blockedCount = 0
  let warningCount = 0
  let readyCount = 0

  questions.forEach((raw, idx) => {
    const normalized = {
      index: raw.index ?? idx,
      no: String(raw.no || idx + 1),
      content: String(raw.content || ''),
      questionImage: String(raw.questionImage || ''),
      options: asArray(raw.options).map(v => String(v || '')),
      answer: String(raw.answer || ''),
      type: inferQuestionType(raw as any),
      analysis: String(raw.analysis || ''),
      rawText: String(raw.rawText || ''),
      fileName: String(raw.fileName || ''),
      relativePath: String(raw.relativePath || ''),
    }
    const quality = evaluateImportQuality(normalized as any)
    const type = normalized.type || '未分类'
    typeBreakdown[type] = (typeBreakdown[type] || 0) + 1

    const fileKey = normalized.relativePath || normalized.fileName || '__default__'
    const fileLabel = normalized.relativePath || normalized.fileName || '未标记来源文件'
    const fileEntry = fileMap.get(fileKey) || {
      key: fileKey,
      label: fileLabel,
      total: 0,
      blockedCount: 0,
      warningCount: 0,
      readyCount: 0,
    }
    fileEntry.total += 1

    if (quality.blockers.length) {
      blockedCount += 1
      fileEntry.blockedCount += 1
      quality.blockers.forEach(issue => {
        blockerMap[issue.label] = (blockerMap[issue.label] || 0) + 1
      })
    } else {
      readyCount += 1
      fileEntry.readyCount += 1
      recommendedPublishIndexes.push(normalized.index)
    }

    if (quality.warnings.length) {
      warningCount += 1
      fileEntry.warningCount += 1
      quality.warnings.forEach(issue => {
        warningMap[issue.label] = (warningMap[issue.label] || 0) + 1
      })
    }

    fileMap.set(fileKey, fileEntry)
  })

  return {
    total: questions.length,
    blockedCount,
    warningCount,
    readyCount,
    blockerReasons: Object.entries(blockerMap)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    warningReasons: Object.entries(warningMap)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    typeBreakdown,
    fileBreakdown: Array.from(fileMap.values()).sort((a, b) => b.total - a.total),
    recommendedPublishIndexes,
  }
}
