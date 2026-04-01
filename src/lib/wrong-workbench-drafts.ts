export type NoteDraft = {
  type: 'note'
  key: string
  wrongId: string
  questionId: string
  title: string
  anchors: string
  noteBody: string
  updatedAt: string
}

export type KnowledgeDraft = {
  type: 'knowledge'
  key: string
  wrongId: string
  questionId: string
  moduleName: string
  nodeName: string
  reason: string
  updatedAt: string
}

export type DraftRecord = NoteDraft | KnowledgeDraft

const NOTE_PREFIX = 'ww_note_draft__'
const KNOWLEDGE_PREFIX = 'ww_knowledge_draft__'

function hasWindow() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function buildDraftKey(kind: 'note' | 'knowledge', wrongId: string, questionId: string) {
  const safeWrongId = wrongId || 'no-wrong-id'
  const safeQuestionId = questionId || 'no-question-id'
  return `${kind === 'note' ? NOTE_PREFIX : KNOWLEDGE_PREFIX}${safeWrongId}__${safeQuestionId}`
}

export function saveDraft(record: DraftRecord) {
  if (!hasWindow()) return
  window.localStorage.setItem(record.key, JSON.stringify(record))
}

export function loadDraft<T extends DraftRecord>(key: string): T | null {
  if (!hasWindow()) return null
  const raw = window.localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function removeDraft(key: string) {
  if (!hasWindow()) return
  window.localStorage.removeItem(key)
}

export function listAllDrafts(): DraftRecord[] {
  if (!hasWindow()) return []
  const result: DraftRecord[] = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    if (!key) continue
    if (!key.startsWith(NOTE_PREFIX) && !key.startsWith(KNOWLEDGE_PREFIX)) continue
    const raw = window.localStorage.getItem(key)
    if (!raw) continue
    try {
      const item = JSON.parse(raw) as DraftRecord
      result.push(item)
    } catch {
      continue
    }
  }
  return result.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
}

export function buildDraftStatusMap(records: DraftRecord[]) {
  const noteMap: Record<string, boolean> = {}
  const knowledgeMap: Record<string, boolean> = {}

  records.forEach(record => {
    const key = `${record.wrongId}__${record.questionId}`
    if (record.type === 'note') noteMap[key] = true
    if (record.type === 'knowledge') knowledgeMap[key] = true
  })

  return { noteMap, knowledgeMap }
}
