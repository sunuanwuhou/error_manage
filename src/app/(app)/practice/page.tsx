'use client'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type QueueItem = {
  id: string
  content: string
  options: string[]
  answer: string
  analysis?: string | null
  type: string
  questionImage?: string | null
}

type ReviewItem = {
  id: string
  content: string
  options: string[]
  correctAnswer: string
  analysis?: string | null
  userAnswer?: string
  isCorrect?: boolean
  type: string
  questionImage?: string | null
}

type StrokePoint = { x: number; y: number; t: number; pressure?: number }
type StrokeRecord = { color: string; width: number; points: StrokePoint[]; createdAt?: string }
type StepRecord = { id: string; text: string }

function parseOptions(raw?: string | null) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function buildProcessSummary(steps: StepRecord[], freeText: string) {
  const normalizedSteps = steps
    .map((step, index) => `${index + 1}. ${step.text.trim()}`)
    .filter(Boolean)
    .join('\n')

  const note = freeText.trim()
  if (normalizedSteps && note) return `${normalizedSteps}\n补充说明：${note}`
  if (normalizedSteps) return normalizedSteps
  return note
}

function drawStrokePath(ctx: CanvasRenderingContext2D, stroke: StrokeRecord) {
  if (!stroke.points.length) return
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.width
  ctx.beginPath()
  const first = stroke.points[0]
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < stroke.points.length; i += 1) {
    const p = stroke.points[i]
    ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
}

export default function PracticePage() {
  const searchParams = useSearchParams()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointerStrokeRef = useRef<StrokeRecord | null>(null)
  const [paperKey, setPaperKey] = useState(searchParams.get('paperKey') || '')
  const [limit, setLimit] = useState(searchParams.get('limit') || '20')
  const [questionId, setQuestionId] = useState(searchParams.get('questionId') || '')
  const [questions, setQuestions] = useState<QueueItem[]>([])
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(false)
  const [startError, setStartError] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState<any>(null)
  const [finished, setFinished] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [reviewIndex, setReviewIndex] = useState(0)
  const [answeredSet, setAnsweredSet] = useState<number[]>([])
  const [stats, setStats] = useState({ correct: 0, wrong: 0, answered: 0 })
  const [processSummaryText, setProcessSummaryText] = useState('')
  const [processSteps, setProcessSteps] = useState<StepRecord[]>([])
  const [stepInput, setStepInput] = useState('')
  const [strokes, setStrokes] = useState<StrokeRecord[]>([])

  const current = questions[idx]
  const currentReview = reviewItems[reviewIndex]

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    strokes.forEach(stroke => drawStrokePath(ctx, stroke))
  }, [strokes, idx])

  function resetProcessInputs() {
    setProcessSummaryText('')
    setProcessSteps([])
    setStepInput('')
    setStrokes([])
    pointerStrokeRef.current = null
  }

  async function startPractice() {
    setLoading(true)
    setStartError('')
    setFinished(false)
    setReviewMode(false)
    setIdx(0)
    setSelected('')
    setResult(null)
    setAnsweredSet([])
    setReviewItems([])
    setStats({ correct: 0, wrong: 0, answered: 0 })
    resetProcessInputs()

    try {
      let nextQuestions: QueueItem[] = []

      if (questionId.trim()) {
        const res = await fetch(`/api/questions/${questionId.trim()}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '加载题目失败')
        const item = data.item
        nextQuestions = [{
          id: item.id,
          content: item.content,
          options: parseOptions(item.options),
          answer: item.answer,
          analysis: item.analysis,
          type: item.type,
          questionImage: item.questionImage,
        }]
      } else {
        const params = new URLSearchParams()
        if (paperKey) params.set('paper', paperKey)
        if (limit) params.set('limit', limit)
        const res = await fetch(`/api/questions/list?${params.toString()}`)
        const payload = await res.json()
        if (!res.ok) throw new Error(payload.error || '加载题目失败')
        nextQuestions = (payload.items || []).map((item: any) => ({
          id: item.id,
          content: item.content,
          options: parseOptions(item.options),
          answer: item.answer,
          analysis: item.analysis,
          type: item.type,
          questionImage: item.questionImage,
        }))
      }

      setQuestions(nextQuestions)
      setReviewItems(nextQuestions.map(q => ({
        id: q.id,
        content: q.content,
        options: q.options,
        correctAnswer: q.answer,
        analysis: q.analysis,
        userAnswer: '',
        isCorrect: false,
        type: q.type,
        questionImage: q.questionImage,
      })))

      const createRes = await fetch('/api/paper-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paperKey: questionId ? `single__${questionId}` : (paperKey || 'manual-practice'),
          paperTitle: questionId ? '单题练习' : (paperKey || '手动练习'),
          totalQuestions: nextQuestions.length,
          snapshot: { currentIndex: 0, step: 'answering', answered: [], marked: [], answers: {} },
        }),
      })
      const createPayload = await createRes.json()
      if (createPayload.session?.id) setSessionId(createPayload.session.id)
    } catch (error: any) {
      setStartError(error?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  function appendStep() {
    const next = stepInput.trim()
    if (!next) return
    setProcessSteps(prev => [...prev, { id: makeId('step'), text: next }])
    setStepInput('')
  }

  function updateStep(stepId: string, text: string) {
    setProcessSteps(prev => prev.map(item => item.id === stepId ? { ...item, text } : item))
  }

  function removeStep(stepId: string) {
    setProcessSteps(prev => prev.filter(item => item.id !== stepId))
  }

  function getCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(canvas.height, event.clientY - rect.top)),
      t: Date.now(),
      pressure: event.pressure || undefined,
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = getCanvasPoint(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerStrokeRef.current = {
      color: '#111111',
      width: 2,
      points: [point],
      createdAt: new Date().toISOString(),
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = getCanvasPoint(event)
    const currentStroke = pointerStrokeRef.current
    const canvas = canvasRef.current
    if (!point || !currentStroke || !canvas) return
    currentStroke.points.push(point)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    strokes.forEach(stroke => drawStrokePath(ctx, stroke))
    drawStrokePath(ctx, currentStroke)
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const currentStroke = pointerStrokeRef.current
    if (!currentStroke) return
    if (currentStroke.points.length >= 1) {
      setStrokes(prev => [...prev, currentStroke])
    }
    pointerStrokeRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function clearCanvas() {
    setStrokes([])
    pointerStrokeRef.current = null
  }

  function undoStroke() {
    setStrokes(prev => prev.slice(0, -1))
    pointerStrokeRef.current = null
  }

  async function submitCurrent() {
    if (!current || !selected) return

    const processSummary = buildProcessSummary(processSteps, processSummaryText)
    let processSessionId = ''
    if (processSummary.trim() || strokes.length || processSteps.length) {
      const processRes = await fetch('/api/process-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questionId: current.id,
          derivedMeta: {
            source: 'practice_page',
            kind: strokes.length ? 'structured_steps_with_strokes' : 'structured_steps_only',
            stepCount: processSteps.length,
            strokeCount: strokes.length,
          },
          events: [
            { eventType: 'create', payload: { source: 'practice_page' } },
            ...processSteps.map((step, index) => ({
              eventType: 'insert_text' as const,
              payload: { kind: 'step', stepIndex: index + 1, text: step.text },
            })),
            ...(processSummaryText.trim() ? [{ eventType: 'insert_text' as const, payload: { kind: 'summary', text: processSummaryText.trim() } }] : []),
          ],
          snapshots: [
            {
              stage: 'before_submit',
              blobRef: processSummary.trim() || '[仅画布过程，无文本总结]',
            },
          ],
          strokes,
        }),
      })
      const processPayload = await processRes.json()
      processSessionId = processPayload.session?.processSessionId || ''
    }

    const res = await fetch('/api/review/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        questionId: current.id,
        userAnswer: selected,
        timeSpent: 30,
        fromPaper: true,
        processSessionIds: processSessionId ? [processSessionId] : [],
        processSummary,
      }),
    })
    const payload = await res.json()
    setResult(payload)
    setAnsweredSet(prev => prev.includes(idx) ? prev : [...prev, idx])
    setReviewItems(prev => prev.map((item, i) => i === idx ? {
      ...item,
      userAnswer: selected,
      isCorrect: payload.isCorrect,
      correctAnswer: payload.correctAnswer,
      analysis: payload.analysis || item.analysis,
    } : item))
    setStats(prev => ({
      answered: prev.answered + (answeredSet.includes(idx) ? 0 : 1),
      correct: prev.correct + (payload.isCorrect ? 1 : 0),
      wrong: prev.wrong + (payload.isCorrect ? 0 : 1),
    }))
  }

  async function moveTo(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= questions.length) return
    if (sessionId) {
      await fetch('/api/paper-sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, currentIndex: nextIndex, step: 'answering', status: 'active' }),
      }).catch(() => {})
    }
    setIdx(nextIndex)
    setSelected('')
    setResult(null)
    resetProcessInputs()
  }

  async function nextQuestion() {
    const nextIndex = idx + 1
    const nextFinished = nextIndex >= questions.length
    if (sessionId) {
      await fetch('/api/paper-sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, currentIndex: nextIndex, step: nextFinished ? 'done' : 'answering', status: nextFinished ? 'completed' : 'active' }),
      }).catch(() => {})
    }
    if (nextFinished) {
      setFinished(true)
      return
    }
    setIdx(nextIndex)
    setSelected('')
    setResult(null)
    resetProcessInputs()
  }

  function restartCurrentRun() {
    setFinished(false)
    setReviewMode(false)
    setIdx(0)
    setSelected('')
    setResult(null)
    setAnsweredSet([])
    setStats({ correct: 0, wrong: 0, answered: 0 })
    resetProcessInputs()
    setReviewItems(prev => prev.map(item => ({
      ...item,
      userAnswer: '',
      isCorrect: false,
    })))
  }

  const progressText = useMemo(() => (questions.length ? `${idx + 1} / ${questions.length}` : '未开始'), [idx, questions.length])
  const reviewProgressText = useMemo(() => (reviewItems.length ? `${reviewIndex + 1} / ${reviewItems.length}` : '未开始'), [reviewIndex, reviewItems.length])

  const accuracy = useMemo(() => {
    if (!stats.answered) return 0
    return Math.round((stats.correct / stats.answered) * 100)
  }, [stats])

  const weakItems = useMemo(() => reviewItems.filter(item => item.userAnswer && !item.isCorrect), [reviewItems])

  const weakTypeBreakdown = useMemo(() => {
    const map: Record<string, number> = {}
    weakItems.forEach(item => {
      map[item.type || '未分类'] = (map[item.type || '未分类'] || 0) + 1
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [weakItems])

  const topWeakType = weakTypeBreakdown[0]?.[0] || ''

  const reviewSuggestion = useMemo(() => {
    if (!weakItems.length) return '本轮没有错题，建议直接提高题量，或切换到更高难度 / 更薄弱模块。'
    if (weakItems.length <= 2) return '错题不多，建议先回看本轮，再单题复训，把错因吃透。'
    if (topWeakType) return `本轮错题主要集中在“${topWeakType}”，建议先回看本轮，再去错题本按该题型集中复训。`
    return '建议先回看本轮，再到错题本做二次训练。'
  }, [weakItems, topWeakType])

  const resultHref = useMemo(() => {
    const params = new URLSearchParams()
    params.set('answered', String(stats.answered))
    params.set('correct', String(stats.correct))
    params.set('wrong', String(stats.wrong))
    params.set('accuracy', String(accuracy))
    if (topWeakType) params.set('weakType', topWeakType)
    if (paperKey) params.set('paperKey', paperKey)
    if (questionId) params.set('questionId', questionId)
    return `/practice/result?${params.toString()}`
  }, [stats, accuracy, topWeakType, paperKey, questionId])

  const processPreview = useMemo(() => buildProcessSummary(processSteps, processSummaryText), [processSteps, processSummaryText])

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold">真题练习</h1>

      <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_140px_1fr_auto]">
          <input value={paperKey} onChange={e => setPaperKey(e.target.value)} placeholder="paperKey：2025__广东__sheng_kao" className="rounded-xl border px-3 py-2" />
          <input value={limit} onChange={e => setLimit(e.target.value)} placeholder="题量" className="rounded-xl border px-3 py-2" />
          <input value={questionId} onChange={e => setQuestionId(e.target.value)} placeholder="单题练习可直接填 questionId" className="rounded-xl border px-3 py-2" />
          <button onClick={startPractice} disabled={loading} className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50">
            {loading ? '加载中...' : '开始练习'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">可按 paperKey 拉一组题，也可直接填 questionId 进入单题练习。</p>
        {startError ? <p className="mt-3 text-sm text-red-600">{startError}</p> : null}
      </section>

      {questions.length > 0 && !reviewMode ? (
        <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="rounded-2xl border bg-slate-50 p-4 text-sm">
            <div className="flex flex-wrap gap-4">
              <p>当前进度：{progressText}</p>
              <p>已作答：{stats.answered}</p>
              <p>答对：{stats.correct}</p>
              <p>答错：{stats.wrong}</p>
              <p>正确率：{accuracy}%</p>
            </div>
          </div>

          <aside className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">题号导航</h2>
              {current ? <Link href={`/questions/${current.id}`} className="rounded-lg border px-3 py-1 text-xs">查看原题</Link> : null}
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {questions.map((_, i) => {
                const isCurrent = i === idx
                const isAnswered = answeredSet.includes(i)
                const cls = isCurrent ? 'border-black bg-black text-white' : isAnswered ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200'
                return (
                  <button key={i} onClick={() => moveTo(i)} className={`rounded-lg border px-2 py-2 text-sm ${cls}`}>
                    {i + 1}
                  </button>
                )
              })}
            </div>
          </aside>
        </section>
      ) : null}

      {questions.length > 0 && !finished && !reviewMode && current ? (
        <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
            <span>{current.type}</span>
            <span>{progressText}</span>
          </div>
          <h2 className="text-lg font-medium whitespace-pre-wrap">{current.content}</h2>
          {current.questionImage ? <img src={current.questionImage} alt="题图" className="mt-4 max-h-96 rounded-xl border" /> : null}

          <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="rounded-2xl border bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">思路步骤</p>
                <span className="text-xs text-slate-500">按步骤写，系统会带入 error_analysis</span>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={stepInput}
                  onChange={e => setStepInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); appendStep() } }}
                  placeholder="例如：先排除绝对化表述；设未知数 x；发现题干问的是“不能推出”"
                  className="flex-1 rounded-xl border bg-white px-3 py-2 text-sm outline-none"
                />
                <button onClick={appendStep} className="rounded-xl border px-4 py-2 text-sm">加入步骤</button>
              </div>
              <div className="mt-3 grid gap-2">
                {processSteps.length ? processSteps.map((step, index) => (
                  <div key={step.id} className="rounded-xl border bg-white p-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>步骤 {index + 1}</span>
                      <button onClick={() => removeStep(step.id)} className="text-red-600">删除</button>
                    </div>
                    <textarea
                      value={step.text}
                      onChange={e => updateStep(step.id, e.target.value)}
                      className="mt-2 min-h-20 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    />
                  </div>
                )) : <p className="text-sm text-slate-500">还没有记录步骤。可以按“审题 → 列式/排除 → 结论”写。</p>}
              </div>
              <div className="mt-3">
                <p className="text-sm font-medium">补充说明</p>
                <textarea
                  value={processSummaryText}
                  onChange={e => setProcessSummaryText(e.target.value)}
                  placeholder="例如：我其实知道列式，但最后把 125÷5 算成了 20；或者把“最不可能”看成“最可能”。"
                  className="mt-2 min-h-28 w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none"
                />
              </div>
            </div>

            <div className="rounded-2xl border bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">过程画布</p>
                <div className="flex gap-2 text-xs">
                  <button onClick={undoStroke} className="rounded-lg border px-3 py-1">撤销</button>
                  <button onClick={clearCanvas} className="rounded-lg border px-3 py-1">清空</button>
                </div>
              </div>
              <canvas
                ref={canvasRef}
                width={320}
                height={220}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                className="mt-3 w-full rounded-xl border bg-white touch-none"
              />
              <div className="mt-3 rounded-xl border bg-white p-3 text-xs text-slate-600">
                <p>已记录步骤：{processSteps.length}</p>
                <p className="mt-1">已记录笔迹：{strokes.length}</p>
                <p className="mt-1 whitespace-pre-wrap">过程预览：{processPreview || '尚未填写'}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            {current.options.map((option, index) => {
              const optionValue = String.fromCharCode(65 + index)
              const active = selected === optionValue
              return (
                <button key={optionValue} onClick={() => setSelected(optionValue)} className={`rounded-xl border px-4 py-3 text-left ${active ? 'border-black bg-slate-50' : 'border-slate-200'}`}>
                  {option}
                </button>
              )
            })}
          </div>
          {!result ? (
            <button onClick={submitCurrent} disabled={!selected} className="mt-6 rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50">提交答案</button>
          ) : (
            <div className="mt-6 rounded-2xl border bg-slate-50 p-4">
              <p className={`font-medium ${result.isCorrect ? 'text-green-700' : 'text-red-700'}`}>{result.isCorrect ? '回答正确' : '回答错误'}</p>
              <p className="mt-2 text-sm">正确答案：{result.correctAnswer}</p>
              {result.analysis ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{result.analysis}</p> : null}
              {result.errorAnalysis ? (
                <div className="mt-3 rounded-xl border bg-amber-50 p-3 text-sm text-slate-700">
                  <p><span className="font-medium">错因：</span>{result.errorAnalysis.errorTypePrimary}</p>
                  <p className="mt-1"><span className="font-medium">根因：</span>{result.errorAnalysis.rootCause}</p>
                  <p className="mt-1"><span className="font-medium">下一步：</span>{result.errorAnalysis.nextAction}</p>
                  {result.errorAnalysis.wrongStepText ? <p className="mt-1 whitespace-pre-wrap"><span className="font-medium">过程摘要：</span>{result.errorAnalysis.wrongStepText}</p> : null}
                </div>
              ) : null}
              <div className="mt-4 flex gap-3">
                <button onClick={() => moveTo(Math.max(0, idx - 1))} className="rounded-xl border px-4 py-2">上一题</button>
                <button onClick={nextQuestion} className="rounded-xl bg-black px-4 py-2 text-white">{idx >= questions.length - 1 ? '完成练习' : '下一题'}</button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {finished && !reviewMode ? (
        <section className="mt-6 grid gap-4">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">练习完成</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">已作答</p>
                <p className="mt-1 text-2xl font-semibold">{stats.answered}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">答对</p>
                <p className="mt-1 text-2xl font-semibold">{stats.correct}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">答错</p>
                <p className="mt-1 text-2xl font-semibold">{stats.wrong}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">正确率</p>
                <p className="mt-1 text-2xl font-semibold">{accuracy}%</p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border bg-amber-50 p-4 text-sm">
              <p className="font-medium">复盘建议</p>
              <p className="mt-2 text-slate-700">{reviewSuggestion}</p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/wrong-questions/workbench/review" className="rounded-xl bg-black px-4 py-2 text-white">开始本轮复盘</Link>
              <button onClick={() => setReviewMode(true)} className="rounded-xl border px-4 py-2">回看本轮</button>
              <button onClick={restartCurrentRun} className="rounded-xl bg-black px-4 py-2 text-white">重新开始</button>
              <Link href="/wrong-questions/workbench" className="rounded-xl border px-4 py-2">去错题工作台</Link>
              <Link href="/wrong-questions" className="rounded-xl border px-4 py-2">旧错题页</Link>
              {weakItems[0] ? <Link href={`/practice?questionId=${weakItems[0].id}`} className="rounded-xl border px-4 py-2">先再练一道错题</Link> : null}
              <Link href={resultHref} className="rounded-xl border px-4 py-2">进入独立结果页</Link>
            </div>
          </div>

          {weakTypeBreakdown.length ? (
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="text-lg font-medium">错题题型分布</h3>
              <div className="mt-4 grid gap-3">
                {weakTypeBreakdown.map(([type, count]) => (
                  <div key={type} className="rounded-xl border p-4 flex items-center justify-between">
                    <span>{type}</span>
                    <span className="text-sm text-slate-500">{count} 题</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {weakItems.length ? (
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="text-lg font-medium">本轮错题摘要</h3>
              <div className="mt-4 grid gap-3">
                {weakItems.map(item => (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
                      <span>{item.type}</span>
                      <span>你的答案：{item.userAnswer || '-'}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap">{item.content}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Link href={`/practice?questionId=${item.id}`} className="rounded-xl border px-4 py-2 text-sm">单题再练</Link>
                      <Link href={`/wrong-questions/workbench/process?questionId=${item.id}`} className="rounded-xl border px-4 py-2 text-sm">看过程回放</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {reviewMode && reviewItems.length ? (
        <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">本轮回看</h2>
            <div className="flex gap-2">
              <button onClick={() => setReviewMode(false)} className="rounded-xl border px-4 py-2 text-sm">退出回看</button>
            </div>
          </div>
          {currentReview ? (
            <div className="mt-5">
              <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
                <span>{currentReview.type}</span>
                <span>{reviewProgressText}</span>
              </div>
              <p className="whitespace-pre-wrap text-lg">{currentReview.content}</p>
              {currentReview.questionImage ? <img src={currentReview.questionImage} alt="题图" className="mt-4 max-h-96 rounded-xl border" /> : null}
              <div className="mt-4 grid gap-2">
                {currentReview.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="rounded-xl border px-4 py-3 text-sm">{option}</div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border bg-slate-50 p-4 text-sm">
                <p>你的答案：{currentReview.userAnswer || '-'}</p>
                <p className="mt-1">正确答案：{currentReview.correctAnswer}</p>
                {currentReview.analysis ? <p className="mt-2 whitespace-pre-wrap text-slate-700">{currentReview.analysis}</p> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={() => setReviewIndex(prev => Math.max(0, prev - 1))} disabled={reviewIndex <= 0} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">上一题</button>
                <button onClick={() => setReviewIndex(prev => Math.min(reviewItems.length - 1, prev + 1))} disabled={reviewIndex >= reviewItems.length - 1} className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50">下一题</button>
                <Link href={`/wrong-questions/workbench/process?questionId=${currentReview.id}`} className="rounded-xl border px-4 py-2 text-sm">看过程回放</Link>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
