export type CompletionRecord = {
  type: 'note_completed' | 'knowledge_completed'
  key: string
  wrongId: string
  questionId: string
  updatedAt: string
}

const NOTE_COMPLETED_PREFIX = 'ww_note_completed__'
const KNOWLEDGE_COMPLETED_PREFIX = 'ww_knowledge_completed__'

function hasWindow() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function buildCompletionKey(kind: 'note' | 'knowledge', wrongId: string, questionId: string) {
  const safeWrongId = wrongId || 'no-wrong-id'
  const safeQuestionId = questionId || 'no-question-id'
  return `${kind === 'note' ? NOTE_COMPLETED_PREFIX : KNOWLEDGE_COMPLETED_PREFIX}${safeWrongId}__${safeQuestionId}`
}

export function markCompleted(kind: 'note' | 'knowledge', wrongId: string, questionId: string) {
  if (!hasWindow()) return
  const key = buildCompletionKey(kind, wrongId, questionId)
  const record: CompletionRecord = {
    type: kind === 'note' ? 'note_completed' : 'knowledge_completed',
    key,
    wrongId,
    questionId,
    updatedAt: new Date().toISOString(),
  }
  window.localStorage.setItem(key, JSON.stringify(record))
}

export function unmarkCompleted(kind: 'note' | 'knowledge', wrongId: string, questionId: string) {
  if (!hasWindow()) return
  const key = buildCompletionKey(kind, wrongId, questionId)
  window.localStorage.removeItem(key)
}

export function listAllCompleted(): CompletionRecord[] {
  if (!hasWindow()) return []
  const result: CompletionRecord[] = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    if (!key) continue
    if (!key.startsWith(NOTE_COMPLETED_PREFIX) && !key.startsWith(KNOWLEDGE_COMPLETED_PREFIX)) continue
    const raw = window.localStorage.getItem(key)
    if (!raw) continue
    try {
      result.push(JSON.parse(raw) as CompletionRecord)
    } catch {
      continue
    }
  }
  return result.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
}

export function buildCompletionStatusMap(records: CompletionRecord[]) {
  const noteMap: Record<string, boolean> = {}
  const knowledgeMap: Record<string, boolean> = {}

  records.forEach(record => {
    const key = `${record.wrongId}__${record.questionId}`
    if (record.type === 'note_completed') noteMap[key] = true
    if (record.type === 'knowledge_completed') knowledgeMap[key] = true
  })

  return { noteMap, knowledgeMap }
}
