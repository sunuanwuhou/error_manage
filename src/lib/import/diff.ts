export type ImportLikeQuestion = {
  index?: number
  no?: string
  content?: string
  questionImage?: string
  options?: string[]
  answer?: string
  type?: string
  analysis?: string
  rawText?: string
}

export type FieldDiff = {
  field: 'content' | 'options' | 'answer' | 'type' | 'analysis' | 'questionImage'
  before: string
  after: string
}

export type QuestionDiffItem = {
  index: number
  no: string
  changed: boolean
  fields: FieldDiff[]
}

function normalizeText(value: unknown) {
  return String(value || '').trim()
}

function normalizeOptions(options: unknown) {
  return Array.isArray(options)
    ? options.map(item => normalizeText(item)).filter(Boolean).join(' | ')
    : ''
}

export function diffQuestion(before: ImportLikeQuestion, after: ImportLikeQuestion, fallbackIndex = 0): QuestionDiffItem {
  const fields: FieldDiff[] = []
  const candidates: Array<QuestionDiffItem['fields'][number]['field']> = ['content', 'options', 'answer', 'type', 'analysis', 'questionImage']

  for (const field of candidates) {
    const prev = field === 'options' ? normalizeOptions(before.options) : normalizeText((before as any)?.[field])
    const next = field === 'options' ? normalizeOptions(after.options) : normalizeText((after as any)?.[field])
    if (prev !== next) fields.push({ field, before: prev, after: next })
  }

  return {
    index: Number(after.index ?? before.index ?? fallbackIndex),
    no: String(after.no || before.no || fallbackIndex + 1),
    changed: fields.length > 0,
    fields,
  }
}

export function summarizeDiff(items: QuestionDiffItem[]) {
  const changedItems = items.filter(item => item.changed)
  const changedFieldCounts: Record<string, number> = {}
  changedItems.forEach(item => {
    item.fields.forEach(field => {
      changedFieldCounts[field.field] = (changedFieldCounts[field.field] || 0) + 1
    })
  })
  return {
    total: items.length,
    changedCount: changedItems.length,
    unchangedCount: items.length - changedItems.length,
    changedFieldCounts,
  }
}
