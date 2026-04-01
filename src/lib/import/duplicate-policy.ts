export type DuplicateMode = 'skip' | 'replace_low_quality' | 'force_replace'

export function normalizeText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function buildFingerprint(input: { content: string; options?: string[]; answer?: string }) {
  return [
    normalizeText(input.content),
    (input.options || []).map(item => normalizeText(item)).join('|'),
    String(input.answer || '').trim().toUpperCase(),
  ].join('||')
}

export function qualityCheck(input: { content: string; options?: string[]; answer?: string; analysis?: string }) {
  const issues: string[] = []
  let score = 100
  if (!input.content || normalizeText(input.content).length < 8) { issues.push('题干过短'); score -= 40 }
  if ((input.options || []).length < 2) { issues.push('选项不足'); score -= 20 }
  if (!input.answer) { issues.push('缺少答案'); score -= 20 }
  if (!input.analysis) { issues.push('缺少解析'); score -= 10 }
  return { score: Math.max(0, score), issues }
}

function safeParseOptions(raw?: string | null) {
  if (!raw) return []
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

export function shouldReplaceExisting(params: {
  mode: DuplicateMode
  existing: { content?: string | null; options?: string | null; analysis?: string | null; answer?: string | null }
  incoming: { content: string; options: string[]; analysis?: string; answer?: string }
}) {
  if (params.mode === 'force_replace') return true
  if (params.mode === 'skip') return false
  const existingQuality = qualityCheck({
    content: params.existing.content || '',
    options: safeParseOptions(params.existing.options),
    analysis: params.existing.analysis || '',
    answer: params.existing.answer || '',
  })
  const incomingQuality = qualityCheck(params.incoming)
  return incomingQuality.score > existingQuality.score
}
