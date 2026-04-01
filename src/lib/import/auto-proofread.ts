export type PreviewItemForProofread = {
  index: number
  no: string
  content: string
  options: string[]
  answer: string
  type: string
  analysis?: string
  rawText?: string
}

export type ProofSuggestion = {
  id: string
  level: 'high' | 'medium' | 'low'
  field: 'content' | 'options' | 'answer' | 'analysis' | 'meta'
  title: string
  reason: string
  patch?: {
    content?: string
    options?: string[]
    answer?: string
    analysis?: string
  }
}

const NEGATIVE_KEYWORDS = ['不正确', '错误', '不能', '不属于', '不包括', '不是', '不应当', '不符合']

function normalizeText(input: string) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/[：:]/g, ':')
    .trim()
}

function extractAnswerFromRaw(raw: string) {
  const text = normalizeText(raw)
  const match =
    text.match(/答案\s*[:：]\s*([A-D])/i) ||
    text.match(/正确答案\s*[:：]\s*([A-D])/i) ||
    text.match(/参考答案\s*[:：]\s*([A-D])/i)
  return match?.[1]?.toUpperCase() || ''
}

function extractOptionLines(raw: string) {
  const lines = String(raw || '').split(/\n+/).map(line => line.trim()).filter(Boolean)
  return lines.filter(line => /^[A-D][\.．、:：]/.test(line))
}

function maybeExtractAnalysis(raw: string) {
  const text = String(raw || '')
  const match = text.match(/(?:解析|答案解析|参考解析)\s*[:：]([\s\S]{8,})/i)
  return match?.[1]?.trim() || ''
}

export function buildProofSuggestions(item: PreviewItemForProofread): ProofSuggestion[] {
  const suggestions: ProofSuggestion[] = []
  const raw = String(item.rawText || '').trim()
  const content = normalizeText(item.content)
  const analysis = normalizeText(item.analysis || '')
  const options = (item.options || []).filter(Boolean)

  if (!item.answer.trim()) {
    const rawAnswer = extractAnswerFromRaw(raw)
    if (rawAnswer) {
      suggestions.push({
        id: 'answer-from-raw',
        level: 'high',
        field: 'answer',
        title: '建议补全答案',
        reason: `原文片段中识别到“答案：${rawAnswer}”`,
        patch: { answer: rawAnswer },
      })
    } else {
      suggestions.push({
        id: 'answer-missing',
        level: 'medium',
        field: 'answer',
        title: '答案缺失',
        reason: '当前题目没有答案，建议优先校对。',
      })
    }
  }

  if (!analysis) {
    const maybeAnalysis = maybeExtractAnalysis(raw)
    if (maybeAnalysis) {
      suggestions.push({
        id: 'analysis-from-raw',
        level: 'medium',
        field: 'analysis',
        title: '建议补全解析',
        reason: '原文片段中疑似存在解析内容。',
        patch: { analysis: maybeAnalysis },
      })
    } else {
      suggestions.push({
        id: 'analysis-missing',
        level: 'medium',
        field: 'analysis',
        title: '解析缺失',
        reason: '当前题目没有解析，建议补充或确认原文是否本身无解析。',
      })
    }
  }

  const rawOptionLines = extractOptionLines(raw)
  if (rawOptionLines.length >= 4 && options.length < 4) {
    suggestions.push({
      id: 'options-missing',
      level: 'high',
      field: 'options',
      title: '选项数量异常',
      reason: `原文中疑似识别到 ${rawOptionLines.length} 个选项，当前仅有 ${options.length} 个。`,
      patch: { options: rawOptionLines.slice(0, 4) },
    })
  } else if (options.length < 4) {
    suggestions.push({
      id: 'options-less-than-4',
      level: 'medium',
      field: 'options',
      title: '选项数量偏少',
      reason: '当前选项少于 4 个，建议检查是否识别缺失。',
    })
  }

  if (raw) {
    const rawNorm = normalizeText(raw)
    if (rawNorm.length > content.length * 1.8 || content.length > rawNorm.length * 1.8) {
      suggestions.push({
        id: 'content-length-gap',
        level: 'low',
        field: 'content',
        title: '题干与原文长度差异较大',
        reason: '当前题干与原文片段长度差异明显，建议人工对照检查是否漏字、串题或截断。',
      })
    }

    const rawHasNegative = NEGATIVE_KEYWORDS.find(k => rawNorm.includes(k))
    if (rawHasNegative && !content.includes(rawHasNegative)) {
      suggestions.push({
        id: 'negative-keyword-missing',
        level: 'medium',
        field: 'content',
        title: '题干可能缺少关键否定词',
        reason: `原文片段中包含“${rawHasNegative}”，但当前题干未明显包含，建议重点核对。`,
      })
    }
  }

  if (!raw) {
    suggestions.push({
      id: 'no-raw-fragment',
      level: 'low',
      field: 'meta',
      title: '暂无原文片段',
      reason: '当前自动校对只能基于已解析文本进行，建议后续补齐更完整的原文片段。',
    })
  }

  return suggestions
}
