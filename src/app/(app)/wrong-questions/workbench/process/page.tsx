'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

type ProcessSessionItem = {
  processSessionId: string
  questionId: string
  attemptId?: string
  startedAt: string
  endedAt?: string
  derivedMeta?: Record<string, unknown>
}

type ProcessEvent = {
  eventId: string
  processSessionId: string
  eventType: string
  payload?: Record<string, unknown>
  createdAt: string
}

type ProcessSnapshot = {
  snapshotId: string
  processSessionId: string
  stage: string
  blobRef: string
  createdAt: string
}

type StrokePoint = { x: number; y: number; t: number; pressure?: number }
type StrokeRecord = { strokeId: string; processSessionId: string; color: string; width: number; points: StrokePoint[]; createdAt: string }

type AnalysisRecord = {
  analysisId: string
  errorTypePrimary?: string
  rootCause?: string
  nextAction?: string
  trainingMode?: string
  wrongStepText?: string
  wrongStepIndex?: number
  processIds?: string[]
}

type ComparePayload = {
  standardSteps: Array<{ index: number; text: string }>
  userSteps: Array<{ index: number; text: string }>
  divergenceStepIndex: number | null
  divergenceReason: string
  replayFocusRange?: { start: number; end: number } | null
}

type ProcessBundle = {
  session: ProcessSessionItem | null
  events: ProcessEvent[]
  snapshots: ProcessSnapshot[]
  strokes: StrokeRecord[]
  replayMeta?: {
    totalEvents: number
    totalSnapshots: number
    totalStrokes: number
    totalStrokePoints: number
    firstEventAt?: string | null
    lastEventAt?: string | null
  }
}

function drawStrokePath(ctx: CanvasRenderingContext2D, stroke: StrokeRecord) {
  if (!stroke.points?.length) return
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = stroke.color || '#111111'
  ctx.lineWidth = Number(stroke.width || 2)
  ctx.beginPath()
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
  for (let i = 1; i < stroke.points.length; i += 1) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
  }
  ctx.stroke()
}

function formatEventLabel(item: ProcessEvent) {
  if (item.eventType === 'insert_text') {
    const kind = String(item.payload?.kind || '')
    const text = String(item.payload?.text || '')
    if (kind === 'step') return `步骤：${text}`
    if (kind === 'summary') return `补充说明：${text}`
    return text || '文本记录'
  }
  if (item.eventType === 'clear') return '清空画布'
  if (item.eventType === 'undo') return '撤销笔迹'
  if (item.eventType === 'create') return '开始记录过程'
  return item.eventType
}

function extractEventStepIndex(item: ProcessEvent) {
  const value = Number(item.payload?.stepIndex || 0)
  return Number.isFinite(value) && value > 0 ? value : null
}

export default function WrongQuestionProcessReplayPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [questionId, setQuestionId] = useState('')
  const [sessions, setSessions] = useState<ProcessSessionItem[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [bundle, setBundle] = useState<ProcessBundle | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [compare, setCompare] = useState<ComparePayload | null>(null)
  const [strokeProgress, setStrokeProgress] = useState(100)
  const [focusWrongStep, setFocusWrongStep] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const q = params.get('questionId') || ''
    const processSessionId = params.get('processSessionId') || ''
    setQuestionId(q)
    if (processSessionId) setSelectedSessionId(processSessionId)
  }, [])

  async function loadByQuestion(nextQuestionId: string) {
    if (!nextQuestionId.trim()) return
    setLoading(true)
    try {
      const [processRes, analysisRes, compareRes] = await Promise.all([
        fetch(`/api/process-sessions?questionId=${encodeURIComponent(nextQuestionId.trim())}`),
        fetch(`/api/error-analysis?questionId=${encodeURIComponent(nextQuestionId.trim())}`),
        fetch(`/api/process-compare?questionId=${encodeURIComponent(nextQuestionId.trim())}`),
      ])
      const processData = await processRes.json()
      const analysisData = await analysisRes.json()
      const compareData = await compareRes.json()
      const nextSessions = processData.items || []
      setSessions(nextSessions)
      setAnalysis(analysisData.item || null)
      setCompare(compareData.item || null)
      setSelectedSessionId(prev => prev || nextSessions[0]?.processSessionId || '')
      if (!nextSessions.length) setBundle(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!questionId) return
    loadByQuestion(questionId).catch(() => setLoading(false))
  }, [questionId])

  useEffect(() => {
    if (!selectedSessionId) return
    Promise.all([
      fetch(`/api/process-sessions?processSessionId=${encodeURIComponent(selectedSessionId)}`).then(res => res.json()),
      fetch(`/api/process-compare?questionId=${encodeURIComponent(questionId)}&processSessionId=${encodeURIComponent(selectedSessionId)}`).then(res => res.json()),
    ])
      .then(([bundleData, compareData]) => {
        setBundle(bundleData)
        setCompare(compareData.item || null)
      })
      .catch(() => { setBundle(null); setCompare(null) })
  }, [selectedSessionId])

  const sortedEvents = useMemo(() => ([...(bundle?.events || [])]).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [bundle])
  const sortedSnapshots = useMemo(() => ([...(bundle?.snapshots || [])]).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [bundle])
  const sortedStrokes = useMemo(() => ([...(bundle?.strokes || [])]).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [bundle])
  const currentSession = bundle?.session || null
  const wrongStepIndex = Number(analysis?.wrongStepIndex || 0) || null
  const stepEvents = useMemo(() => sortedEvents.filter(item => item.eventType === 'insert_text' && item.payload?.kind === 'step'), [sortedEvents])
  const focusedStepText = useMemo(() => {
    if (!wrongStepIndex) return analysis?.wrongStepText || ''
    const target = stepEvents.find(item => extractEventStepIndex(item) === wrongStepIndex)
    return String(target?.payload?.text || analysis?.wrongStepText || '')
  }, [wrongStepIndex, stepEvents, analysis])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const visibleStrokeCount = Math.max(0, Math.ceil(sortedStrokes.length * (strokeProgress / 100)))
    sortedStrokes.slice(0, visibleStrokeCount).forEach(stroke => drawStrokePath(ctx, stroke))
  }, [sortedStrokes, strokeProgress])

  const visibleEvents = useMemo(() => {
    if (!focusWrongStep || !wrongStepIndex) return sortedEvents
    return sortedEvents.filter(item => {
      const idx = extractEventStepIndex(item)
      if (idx === null) return true
      return idx <= wrongStepIndex + 1
    })
  }, [sortedEvents, focusWrongStep, wrongStepIndex])

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold">过程回放</h1>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={questionId}
            onChange={e => setQuestionId(e.target.value)}
            placeholder="输入 questionId 加载过程记录"
            className="rounded-xl border px-3 py-2"
          />
          <button onClick={() => loadByQuestion(questionId)} className="rounded-xl bg-black px-4 py-2 text-white">加载过程</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/wrong-questions/workbench" className="rounded-xl border px-4 py-2">回错题工作台</Link>
          {questionId ? <Link href={`/practice?questionId=${questionId}`} className="rounded-xl border px-4 py-2">回到该题重做</Link> : null}
        </div>
      </section>

      {analysis ? (
        <section className="mt-6 rounded-2xl border bg-amber-50 p-6 text-sm shadow-sm">
          <p><span className="font-medium">系统错因：</span>{analysis.errorTypePrimary || '待生成'}</p>
          <p className="mt-2"><span className="font-medium">根因：</span>{analysis.rootCause || '待生成'}</p>
          <p className="mt-2"><span className="font-medium">下一步：</span>{analysis.nextAction || '待生成'}</p>
          {wrongStepIndex ? <p className="mt-2"><span className="font-medium">系统判断最早偏离步骤：</span>第 {wrongStepIndex} 步</p> : null}
          {focusedStepText ? <p className="mt-2 whitespace-pre-wrap"><span className="font-medium">定位文本：</span>{focusedStepText}</p> : null}
        </section>
      ) : null}

      {loading ? <p className="mt-6 text-sm text-slate-500">加载中...</p> : null}

      {compare ? (
        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-medium">用户过程步骤</h2>
            <div className="mt-4 grid gap-3 text-sm">
              {compare.userSteps.length ? compare.userSteps.map(step => {
                const active = step.index === compare.divergenceStepIndex
                return (
                  <div key={step.index} className={`rounded-xl border p-3 ${active ? 'border-amber-500 bg-amber-50' : 'border-slate-200'}`}>
                    <p className="font-medium">第 {step.index} 步</p>
                    <p className="mt-2 whitespace-pre-wrap">{step.text}</p>
                  </div>
                )
              }) : <p className="text-slate-500">暂无结构化过程步骤。</p>}
            </div>
          </div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-medium">标准解法路径</h2>
            <div className="mt-4 grid gap-3 text-sm">
              {compare.standardSteps.length ? compare.standardSteps.map(step => {
                const active = step.index === compare.divergenceStepIndex
                return (
                  <div key={step.index} className={`rounded-xl border p-3 ${active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                    <p className="font-medium">第 {step.index} 步</p>
                    <p className="mt-2 whitespace-pre-wrap">{step.text}</p>
                  </div>
                )
              }) : <p className="text-slate-500">暂无可拆分的标准步骤。</p>}
            </div>
            <div className="mt-4 rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">
              <p><span className="font-medium">分歧判断：</span>{compare.divergenceReason}</p>
              {compare.replayFocusRange ? <p className="mt-2"><span className="font-medium">建议聚焦：</span>第 {compare.replayFocusRange.start} - {compare.replayFocusRange.end} 步</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">过程会话</h2>
            <span className="text-sm text-slate-500">{sessions.length} 条</span>
          </div>
          <div className="mt-4 grid gap-3">
            {sessions.length ? sessions.map(item => {
              const active = item.processSessionId === selectedSessionId
              const stepCount = Number(item.derivedMeta?.stepCount || 0)
              const strokeCount = Number(item.derivedMeta?.strokeCount || 0)
              return (
                <button
                  key={item.processSessionId}
                  onClick={() => setSelectedSessionId(item.processSessionId)}
                  className={`rounded-xl border p-3 text-left ${active ? 'border-black bg-slate-50' : 'border-slate-200'}`}
                >
                  <p className="text-sm font-medium">{new Date(item.startedAt).toLocaleString()}</p>
                  <p className="mt-1 text-xs text-slate-500">步骤 {stepCount} · 笔迹 {strokeCount}</p>
                  <p className="mt-1 text-xs text-slate-500">{String(item.derivedMeta?.kind || '未标记')}</p>
                </button>
              )
            }) : <p className="text-sm text-slate-500">当前题目还没有过程记录。</p>}
          </div>
        </aside>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          {!currentSession ? <p className="text-sm text-slate-500">请选择一条过程会话查看。</p> : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-500">开始时间</p>
                  <p className="text-lg font-semibold">{new Date(currentSession.startedAt).toLocaleString()}</p>
                </div>
                <div className="text-sm text-slate-600">
                  <p>步骤：{Number(currentSession.derivedMeta?.stepCount || 0)}</p>
                  <p>笔迹：{Number(currentSession.derivedMeta?.strokeCount || 0)}</p>
                  <p>点数：{bundle?.replayMeta?.totalStrokePoints || 0}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-medium">事件时间线</h3>
                    {wrongStepIndex ? (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input type="checkbox" checked={focusWrongStep} onChange={e => setFocusWrongStep(e.target.checked)} />
                        聚焦错步附近
                      </label>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3">
                    {visibleEvents.length ? visibleEvents.map(item => {
                      const stepIndex = extractEventStepIndex(item)
                      const hitWrong = wrongStepIndex && stepIndex === wrongStepIndex
                      return (
                        <div key={item.eventId} className={`rounded-xl border p-3 text-sm ${hitWrong ? 'border-amber-400 bg-amber-50' : 'bg-slate-50'}`}>
                          <p className="font-medium">{formatEventLabel(item)}</p>
                          {stepIndex ? <p className="mt-1 text-xs text-slate-500">步骤号：{stepIndex}</p> : null}
                          <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
                        </div>
                      )
                    }) : <p className="text-sm text-slate-500">没有事件记录。</p>}
                  </div>
                </div>

                <div>
                  <h3 className="text-base font-medium">过程画布回放</h3>
                  <canvas ref={canvasRef} width={560} height={320} className="mt-3 w-full rounded-2xl border bg-white" />
                  <div className="mt-3 rounded-xl border bg-slate-50 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>回放进度</span>
                      <span>{strokeProgress}%</span>
                    </div>
                    <input type="range" min={0} max={100} value={strokeProgress} onChange={e => setStrokeProgress(Number(e.target.value))} className="mt-3 w-full" />
                    <p className="mt-2 text-xs text-slate-500">拖动滑块可从早到晚逐步重绘笔迹。</p>
                  </div>
                  <div className="mt-4 grid gap-3">
                    <div className="rounded-xl border bg-slate-50 p-4 text-sm">
                      <p className="font-medium">过程快照</p>
                      <div className="mt-3 grid gap-3">
                        {sortedSnapshots.length ? sortedSnapshots.map(item => (
                          <div key={item.snapshotId} className="rounded-xl border bg-white p-3">
                            <p className="text-xs text-slate-500">{item.stage} · {new Date(item.createdAt).toLocaleString()}</p>
                            <p className="mt-2 whitespace-pre-wrap">{item.blobRef}</p>
                          </div>
                        )) : <p className="text-sm text-slate-500">没有快照内容。</p>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  )
}
