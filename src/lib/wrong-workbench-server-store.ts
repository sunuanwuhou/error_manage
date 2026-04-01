import { promises as fs } from 'fs'
import path from 'path'

export type WrongWorkbenchNoteRecord = {
  wrongId: string
  questionId: string
  title: string
  anchors: string
  noteBody: string
  completed: boolean
  updatedAt: string
}

export type WrongWorkbenchKnowledgeRecord = {
  wrongId: string
  questionId: string
  moduleName: string
  nodeName: string
  reason: string
  completed: boolean
  updatedAt: string
}

type WrongWorkbenchServerState = {
  notes: WrongWorkbenchNoteRecord[]
  knowledgeLinks: WrongWorkbenchKnowledgeRecord[]
}

const EMPTY_STATE: WrongWorkbenchServerState = {
  notes: [],
  knowledgeLinks: [],
}

function getStoreDir() {
  return path.join(process.cwd(), '.runtime', 'wrong-workbench')
}

function getUserStorePath(userId: string) {
  return path.join(getStoreDir(), `${userId}.json`)
}

async function ensureDir() {
  await fs.mkdir(getStoreDir(), { recursive: true })
}

export async function loadWorkbenchState(userId: string): Promise<WrongWorkbenchServerState> {
  await ensureDir()
  const file = getUserStorePath(userId)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
      knowledgeLinks: Array.isArray(parsed?.knowledgeLinks) ? parsed.knowledgeLinks : [],
    }
  } catch {
    return EMPTY_STATE
  }
}

export async function saveWorkbenchState(userId: string, state: WrongWorkbenchServerState) {
  await ensureDir()
  const file = getUserStorePath(userId)
  await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf8')
}

export async function upsertNoteRecord(userId: string, record: WrongWorkbenchNoteRecord) {
  const state = await loadWorkbenchState(userId)
  const idx = state.notes.findIndex(item => item.wrongId === record.wrongId && item.questionId === record.questionId)
  if (idx >= 0) state.notes[idx] = record
  else state.notes.unshift(record)
  await saveWorkbenchState(userId, state)
  return record
}

export async function upsertKnowledgeRecord(userId: string, record: WrongWorkbenchKnowledgeRecord) {
  const state = await loadWorkbenchState(userId)
  const idx = state.knowledgeLinks.findIndex(item => item.wrongId === record.wrongId && item.questionId === record.questionId)
  if (idx >= 0) state.knowledgeLinks[idx] = record
  else state.knowledgeLinks.unshift(record)
  await saveWorkbenchState(userId, state)
  return record
}

export async function getNoteRecord(userId: string, wrongId: string, questionId: string) {
  const state = await loadWorkbenchState(userId)
  return state.notes.find(item => item.wrongId === wrongId && item.questionId === questionId) || null
}

export async function getKnowledgeRecord(userId: string, wrongId: string, questionId: string) {
  const state = await loadWorkbenchState(userId)
  return state.knowledgeLinks.find(item => item.wrongId === wrongId && item.questionId === questionId) || null
}
