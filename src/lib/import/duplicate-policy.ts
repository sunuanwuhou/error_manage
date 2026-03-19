import type { ParsedQuestion } from '../parsers/pdf-parser'

export type DuplicateMode = 'skip' | 'replace_low_quality' | 'force_replace'

export interface ExistingQuestionSnapshot {
  content: string
  options: string | null
  answer: string | null
  analysis?: string | null
  type: string | null
  srcExamSession?: string | null
  srcQuestionNo?: string | null
  srcQuestionOrder?: number | null
}

export function normalizeText(text: string) {
  return text
    .replace(/\s+/g, '')
    .replace(/[（）()【】\[\]，。、“”‘’：:；;,.!?？！\-—_]/g, '')
    .trim()
}

export function buildFingerprint(q: ParsedQuestion) {
  return [
    normalizeText(q.content).slice(0, 180),
    q.options.map(opt => normalizeText(opt)).join('|'),
    q.answer || '',
    q.type || '',
  ].join('::')
}

export function qualityCheck(q: ParsedQuestion): {
  score: number
  issues: string[]
} {
  const issues: string[] = []
  let score = 100
  const normalizedContentLength = normalizeText(q.content).length
  const hasFullOptions = q.options.length >= 4
  const hasImage = Boolean(q.questionImage)
  const isMaterialDrivenType = q.type === '资料分析'

  if (normalizedContentLength < 8) {
    issues.push('题目过短，可能截断')
    score -= 30
  } else if (normalizedContentLength < 20 && !hasImage && !(isMaterialDrivenType && hasFullOptions)) {
    issues.push('题目过短，可能截断')
    score -= 20
  }
  if (q.options.length < 4) { issues.push(`选项只有${q.options.length}个`); score -= 20 }
  if (!q.answer) { issues.push('缺少答案'); score -= 15 }
  if (q.answer && !/^[ABCD]$/.test(q.answer)) { issues.push(`答案格式异常: ${q.answer}`); score -= 15 }

  if (q.options.length > 0) {
    const letters = q.options.map(o => o.charAt(0)).sort()
    const expected = ['A', 'B', 'C', 'D'].slice(0, letters.length)
    if (JSON.stringify(letters) !== JSON.stringify(expected)) {
      issues.push('选项字母不连续'); score -= 10
    }
  }

  if (/[AB]\.[^\n]{2,}[CD]\./.test(q.content)) {
    issues.push('选项可能混入题目正文'); score -= 20
  }

  if (!q.analysis?.trim()) {
    score -= 5
  }

  return { score: Math.max(0, score), issues }
}

export function toParsedQuestion(existing: ExistingQuestionSnapshot): ParsedQuestion {
  let options: string[] = []
  try {
    const parsed = JSON.parse(existing.options ?? '[]')
    if (Array.isArray(parsed)) {
      options = parsed.map(item => String(item))
    }
  } catch {}

  return {
    no: existing.srcQuestionNo ?? '',
    content: existing.content ?? '',
    options,
    answer: existing.answer ?? '',
    type: existing.type ?? '',
    analysis: existing.analysis ?? '',
    rawText: '',
  }
}

export function shouldReplaceExisting(
  mode: DuplicateMode,
  incoming: ParsedQuestion,
  existing: ExistingQuestionSnapshot
) {
  if (mode === 'force_replace') {
    return true
  }

  if (mode === 'skip') {
    return false
  }

  const incomingQuality = qualityCheck(incoming)
  const existingParsed = toParsedQuestion(existing)
  const existingQuality = qualityCheck(existingParsed)

  const incomingHasMoreOptions = incoming.options.length > existingParsed.options.length
  const incomingHasAnswer = Boolean(incoming.answer) && !existing.answer
  const incomingHasAnalysis = Boolean(incoming.analysis?.trim()) && !existing.analysis?.trim()
  const incomingContentClearlyLonger = normalizeText(incoming.content).length >= normalizeText(existing.content ?? '').length + 6
  const existingMissingCoreFields = (
    existingParsed.options.length < 4
    || !existing.answer
    || !existing.analysis?.trim()
  )
  const incomingClearlyBetter = incomingQuality.score >= existingQuality.score + 10
  const existingIsLowQuality = existingQuality.score < 75

  return (
    existingIsLowQuality
    || existingMissingCoreFields
    || incomingContentClearlyLonger
  ) && (
    incomingClearlyBetter
    || incomingHasMoreOptions
    || incomingHasAnswer
    || incomingHasAnalysis
    || incomingContentClearlyLonger
  )
}
