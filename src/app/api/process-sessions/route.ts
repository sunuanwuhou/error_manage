import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import {
  appendProcessEventRecords,
  appendProcessSnapshotRecords,
  appendStrokeRecords,
  listProcessBundle,
  listProcessSessionsByQuestion,
  upsertProcessSessionRecord,
} from '@/lib/mainline-record-server-store'
import { buildRuntimeId } from '@/lib/error-analysis'

const postSchema = z.object({
  processSessionId: z.string().optional(),
  questionId: z.string().min(1),
  attemptId: z.string().optional(),
  deviceMeta: z.record(z.any()).optional(),
  derivedMeta: z.record(z.any()).optional(),
  events: z.array(z.object({
    eventType: z.enum(['create', 'clear', 'undo', 'redo', 'insert_text', 'highlight', 'snapshot']),
    payload: z.record(z.any()).optional(),
    createdAt: z.string().optional(),
  })).optional(),
  snapshots: z.array(z.object({
    stage: z.enum(['checkpoint', 'before_submit', 'before_analysis', 'manual']),
    blobRef: z.string(),
    createdAt: z.string().optional(),
  })).optional(),
  strokes: z.array(z.object({
    color: z.string(),
    width: z.number(),
    points: z.array(z.object({ x: z.number(), y: z.number(), t: z.number(), pressure: z.number().optional() })),
    createdAt: z.string().optional(),
  })).optional(),
  endedAt: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const { searchParams } = new URL(req.url)
  const processSessionId = String(searchParams.get('processSessionId') || '').trim()
  const questionId = String(searchParams.get('questionId') || '').trim()

  if (processSessionId) {
    const bundle = await listProcessBundle(userId, processSessionId)
    return NextResponse.json(bundle)
  }
  if (!questionId) return NextResponse.json({ error: '缺少 questionId 或 processSessionId' }, { status: 400 })
  const items = await listProcessSessionsByQuestion(userId, questionId)
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id
  const parsed = postSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })

  const data = parsed.data
  const processSessionId = data.processSessionId || buildRuntimeId('process')
  const startedAt = new Date().toISOString()
  const sessionRecord = {
    processSessionId,
    questionId: data.questionId,
    attemptId: data.attemptId || '',
    startedAt,
    endedAt: data.endedAt,
    deviceMeta: data.deviceMeta || {},
    derivedMeta: data.derivedMeta || {},
  }

  await upsertProcessSessionRecord(userId, sessionRecord)

  const events = (data.events || []).map(item => ({
    eventId: buildRuntimeId('event'),
    processSessionId,
    eventType: item.eventType,
    payload: item.payload || {},
    createdAt: item.createdAt || new Date().toISOString(),
  }))
  const snapshots = (data.snapshots || []).map(item => ({
    snapshotId: buildRuntimeId('snapshot'),
    processSessionId,
    stage: item.stage,
    blobRef: item.blobRef,
    createdAt: item.createdAt || new Date().toISOString(),
  }))
  const strokes = (data.strokes || []).map(item => ({
    strokeId: buildRuntimeId('stroke'),
    processSessionId,
    color: item.color,
    width: item.width,
    points: item.points,
    createdAt: item.createdAt || new Date().toISOString(),
  }))

  await Promise.all([
    appendProcessEventRecords(userId, events),
    appendProcessSnapshotRecords(userId, snapshots),
    appendStrokeRecords(userId, strokes),
  ])

  return NextResponse.json({ session: sessionRecord, events, snapshots, strokes }, { status: 201 })
}
