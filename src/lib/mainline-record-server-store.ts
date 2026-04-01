import { promises as fs } from 'fs'
import path from 'path'
import type {
  AttemptRecord,
  ReviewTaskRecord,
  ScoreRecord,
} from '@/contracts/record-layer.types'
import type {
  ProcessEventRecord,
  ProcessSessionRecord,
  ProcessSnapshotRecord,
  StrokeRecord,
} from '@/contracts/process-canvas.types'
import type { ErrorAnalysisRecord } from '@/contracts/error-analysis.types'

export type MainlineRuntimeState = {
  attempts: AttemptRecord[]
  scores: ScoreRecord[]
  analyses: ErrorAnalysisRecord[]
  reviewTasks: ReviewTaskRecord[]
  processSessions: ProcessSessionRecord[]
  processEvents: ProcessEventRecord[]
  processSnapshots: ProcessSnapshotRecord[]
  strokes: StrokeRecord[]
}

const EMPTY_STATE: MainlineRuntimeState = {
  attempts: [],
  scores: [],
  analyses: [],
  reviewTasks: [],
  processSessions: [],
  processEvents: [],
  processSnapshots: [],
  strokes: [],
}

function getStoreDir() {
  return path.join(process.cwd(), '.runtime', 'mainline-records')
}

function getUserStorePath(userId: string) {
  return path.join(getStoreDir(), `${userId}.json`)
}

async function ensureDir() {
  await fs.mkdir(getStoreDir(), { recursive: true })
}

function cloneEmptyState(): MainlineRuntimeState {
  return {
    attempts: [],
    scores: [],
    analyses: [],
    reviewTasks: [],
    processSessions: [],
    processEvents: [],
    processSnapshots: [],
    strokes: [],
  }
}

export async function loadMainlineState(userId: string): Promise<MainlineRuntimeState> {
  await ensureDir()
  const file = getUserStorePath(userId)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      attempts: Array.isArray(parsed?.attempts) ? parsed.attempts : [],
      scores: Array.isArray(parsed?.scores) ? parsed.scores : [],
      analyses: Array.isArray(parsed?.analyses) ? parsed.analyses : [],
      reviewTasks: Array.isArray(parsed?.reviewTasks) ? parsed.reviewTasks : [],
      processSessions: Array.isArray(parsed?.processSessions) ? parsed.processSessions : [],
      processEvents: Array.isArray(parsed?.processEvents) ? parsed.processEvents : [],
      processSnapshots: Array.isArray(parsed?.processSnapshots) ? parsed.processSnapshots : [],
      strokes: Array.isArray(parsed?.strokes) ? parsed.strokes : [],
    }
  } catch {
    return cloneEmptyState()
  }
}

export async function saveMainlineState(userId: string, state: MainlineRuntimeState) {
  await ensureDir()
  const file = getUserStorePath(userId)
  await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf8')
}

function upsertById<T extends Record<string, any>>(items: T[], idKey: keyof T, next: T) {
  const index = items.findIndex(item => item[idKey] === next[idKey])
  if (index >= 0) items[index] = next
  else items.unshift(next)
}

export async function upsertAttemptRecord(userId: string, record: AttemptRecord) {
  const state = await loadMainlineState(userId)
  upsertById(state.attempts, 'attemptId', record)
  await saveMainlineState(userId, state)
  return record
}

export async function upsertScoreRecord(userId: string, record: ScoreRecord) {
  const state = await loadMainlineState(userId)
  upsertById(state.scores, 'scoreId', record)
  await saveMainlineState(userId, state)
  return record
}

export async function upsertAnalysisRecord(userId: string, record: ErrorAnalysisRecord) {
  const state = await loadMainlineState(userId)
  upsertById(state.analyses, 'analysisId', record)
  await saveMainlineState(userId, state)
  return record
}

export async function upsertReviewTaskRecord(userId: string, record: ReviewTaskRecord) {
  const state = await loadMainlineState(userId)
  upsertById(state.reviewTasks, 'reviewTaskId', record)
  await saveMainlineState(userId, state)
  return record
}


export async function patchReviewTaskRecord(userId: string, reviewTaskId: string, patch: Partial<ReviewTaskRecord>) {
  const state = await loadMainlineState(userId)
  const current = state.reviewTasks.find(item => item.reviewTaskId === reviewTaskId)
  if (!current) return null
  const next = { ...current, ...patch }
  upsertById(state.reviewTasks, 'reviewTaskId', next)
  await saveMainlineState(userId, state)
  return next
}

export async function patchReviewTasksByQuestion(userId: string, questionId: string, patch: Partial<ReviewTaskRecord>) {
  const state = await loadMainlineState(userId)
  const matched = state.reviewTasks.filter(item => item.questionId === questionId)
  if (!matched.length) return []
  const nextItems = matched.map(item => ({ ...item, ...patch }))
  nextItems.forEach(item => upsertById(state.reviewTasks, 'reviewTaskId', item))
  await saveMainlineState(userId, state)
  return nextItems
}

export async function upsertProcessSessionRecord(userId: string, record: ProcessSessionRecord) {
  const state = await loadMainlineState(userId)
  upsertById(state.processSessions, 'processSessionId', record)
  await saveMainlineState(userId, state)
  return record
}

export async function patchProcessSessionRecord(userId: string, processSessionId: string, patch: Partial<ProcessSessionRecord>) {
  const state = await loadMainlineState(userId)
  const current = state.processSessions.find(item => item.processSessionId === processSessionId)
  if (!current) return null
  const next = { ...current, ...patch }
  upsertById(state.processSessions, 'processSessionId', next)
  await saveMainlineState(userId, state)
  return next
}

export async function appendProcessEventRecords(userId: string, records: ProcessEventRecord[]) {
  if (!records.length) return records
  const state = await loadMainlineState(userId)
  state.processEvents.unshift(...records)
  await saveMainlineState(userId, state)
  return records
}

export async function appendProcessSnapshotRecords(userId: string, records: ProcessSnapshotRecord[]) {
  if (!records.length) return records
  const state = await loadMainlineState(userId)
  state.processSnapshots.unshift(...records)
  await saveMainlineState(userId, state)
  return records
}

export async function appendStrokeRecords(userId: string, records: StrokeRecord[]) {
  if (!records.length) return records
  const state = await loadMainlineState(userId)
  state.strokes.unshift(...records)
  await saveMainlineState(userId, state)
  return records
}

export async function findLatestAnalysisByQuestion(userId: string, questionId: string) {
  const state = await loadMainlineState(userId)
  return state.analyses.find(item => item.questionId === questionId) || null
}

export async function findAnalysisByAttempt(userId: string, attemptId: string) {
  const state = await loadMainlineState(userId)
  return state.analyses.find(item => item.attemptId === attemptId) || null
}

export async function listQuestionMainlineRecords(userId: string, questionId: string) {
  const state = await loadMainlineState(userId)
  return {
    attempts: state.attempts.filter(item => item.questionId === questionId),
    scores: state.scores.filter(item => item.questionId === questionId),
    analyses: state.analyses.filter(item => item.questionId === questionId),
    reviewTasks: state.reviewTasks.filter(item => item.questionId === questionId),
    processSessions: state.processSessions.filter(item => item.questionId === questionId),
  }
}

export async function listProcessSessionsByQuestion(userId: string, questionId: string) {
  const state = await loadMainlineState(userId)
  return state.processSessions.filter(item => item.questionId === questionId)
}

export async function listProcessBundle(userId: string, processSessionId: string) {
  const state = await loadMainlineState(userId)
  const session = state.processSessions.find(item => item.processSessionId === processSessionId) || null
  const events = state.processEvents.filter(item => item.processSessionId === processSessionId)
  const snapshots = state.processSnapshots.filter(item => item.processSessionId === processSessionId)
  const strokes = state.strokes.filter(item => item.processSessionId === processSessionId)
  return {
    session,
    events,
    snapshots,
    strokes,
    replayMeta: {
      totalEvents: events.length,
      totalSnapshots: snapshots.length,
      totalStrokes: strokes.length,
      totalStrokePoints: strokes.reduce((sum, item) => sum + (item.points?.length || 0), 0),
      firstEventAt: events[events.length - 1]?.createdAt || session?.startedAt || null,
      lastEventAt: events[0]?.createdAt || session?.endedAt || null,
    },
  }
}

export { EMPTY_STATE }
