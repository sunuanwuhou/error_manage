'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { buildNextAction, buildReasonBreakdown, type WrongWorkbenchItem } from '@/lib/wrong-workbench'
import { buildDraftStatusMap, listAllDrafts } from '@/lib/wrong-workbench-drafts'

type NoteRecord = {
  wrongId: string
  questionId: string
  completed: boolean
}

type KnowledgeRecord = {
  wrongId: string
  questionId: string
  completed: boolean
}

type DispatchItem = {
  id: string
  questionId: string
  content: string
  questionType?: string
  errorReason?: string
  masteryPercent?: number
  nextReviewAt?: string | null
  dispatchReason: string
  dispatchPriority: number
  trainingMode?: string
  wrongStepIndex?: number
  retrainHref?: string
}

type LatestAnalysis = {
  errorTypePrimary?: string
  nextAction?: string
  trainingMode?: string
  wrongStepIndex?: number
}

function buildStatusMap<T extends { wrongId: string; questionId: string; completed: boolean }>(records: T[]) {
  const savedMap: Record<string, boolean> = {}
  const completedMap: Record<string, boolean> = {}
  records.forEach(record => {
    const key = `${record.wrongId}__${record.questionId}`
    savedMap[key] = true
    if (record.completed) completedMap[key] = true
  })
  return { savedMap, completedMap }
}

export default function WrongQuestionsWorkbenchPage() {
  const [items, setItems] = useState<(WrongWorkbenchItem & { latestAnalysis?: LatestAnalysis | null; processReplayHref?: string; retrainHref?: string })[]>([])
  const [dispatchItems, setDispatchItems] = useState<DispatchItem[]>([])
  const [dispatchSummary, setDispatchSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [onlyDue, setOnlyDue] = useState(false)
  const [onlyLowMastery, setOnlyLowMastery] = useState(false)
  const [dispatchMode, setDispatchMode] = useState(false)
  const [noteDraftMap, setNoteDraftMap] = useState<Record<string, boolean>>({})
  const [knowledgeDraftMap, setKnowledgeDraftMap] = useState<Record<string, boolean>>({})
  const [noteSavedMap, setNoteSavedMap] = useState<Record<string, boolean>>({})
  const [knowledgeSavedMap, setKnowledgeSavedMap] = useState<Record<string, boolean>>({})
  const [noteCompletedMap, setNoteCompletedMap] = useState<Record<string, boolean>>({})
  const [knowledgeCompletedMap, setKnowledgeCompletedMap] = useState<Record<string, boolean>>({})

  async function loadData() {
    setLoading(true)
    try {
      const [wrongRes, notesRes, knowledgeRes, dispatchRes] = await Promise.all([
        fetch('/api/wrong-questions'),
        fetch('/api/wrong-questions/workbench/notes'),
        fetch('/api/wrong-questions/workbench/knowledge-links'),
        fetch('/api/wrong-questions/workbench/training-dispatch'),
      ])

      const wrongData = await wrongRes.json()
      const notesData = await notesRes.json()
      const knowledgeData = await knowledgeRes.json()
      const dispatchData = await dispatchRes.json()

      const next = (wrongData.items || []).map((item: any) => ({
        id: item.id,
        questionId: item.questionId || item.question?.id || '',
        content: item.question?.content || item.content || '',
        questionType: item.question?.type || item.questionType || '未分类',
        userAnswer: item.myAnswer || item.userAnswer || '',
        correctAnswer: item.question?.answer || item.correctAnswer || '',
        errorReason: item.errorReason || '',
        masteryPercent: item.masteryPercent ?? 0,
        nextReviewAt: item.nextReviewAt || null,
        latestAnalysis: item.latestAnalysis || null,
        processReplayHref: item.processReplayHref || '',
        retrainHref: item.retrainHref || '',
      }))
      setItems(next)
      setDispatchItems(dispatchData.items || [])
      setDispatchSummary(dispatchData.summary || null)

      const noteMaps = buildStatusMap((notesData.items || []) as NoteRecord[])
      const knowledgeMaps = buildStatusMap((knowledgeData.items || []) as KnowledgeRecord[])
      setNoteSavedMap(noteMaps.savedMap)
      setKnowledgeSavedMap(knowledgeMaps.savedMap)
      setNoteCompletedMap(noteMaps.completedMap)
      setKnowledgeCompletedMap(knowledgeMaps.completedMap)
    } finally {
      setLoading(false)
    }
  }

  function loadDraftStatus() {
    const drafts = listAllDrafts()
    const { noteMap, knowledgeMap } = buildDraftStatusMap(drafts)
    setNoteDraftMap(noteMap)
    setKnowledgeDraftMap(knowledgeMap)
  }

  useEffect(() => {
    loadData().catch(() => setLoading(false))
    loadDraftStatus()
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('mode') === 'dispatch') setDispatchMode(true)
    }
  }, [])

  const baseFiltered = useMemo(() => {
    return items.filter(item => {
      const matchType = typeFilter === 'all' || (item.questionType || '未分类') === typeFilter
      const q = query.trim().toLowerCase()
      const matchQuery = !q || item.content.toLowerCase().includes(q) || String(item.errorReason || '').toLowerCase().includes(q)
      const matchDue = !onlyDue || Boolean(item.nextReviewAt)
      const matchMastery = !onlyLowMastery || Number(item.masteryPercent ?? 0) < 60
      return matchType && matchQuery && matchDue && matchMastery
    })
  }, [items, query, typeFilter, onlyDue, onlyLowMastery])

  const filtered = useMemo(() => {
    if (!dispatchMode) return baseFiltered
    const q = query.trim().toLowerCase()
    return dispatchItems.filter(item => {
      const matchType = typeFilter === 'all' || (item.questionType || '未分类') === typeFilter
      const matchQuery = !q || item.content.toLowerCase().includes(q) || String(item.errorReason || '').toLowerCase().includes(q)
      const matchDue = !onlyDue || Boolean(item.nextReviewAt)
      const matchMastery = !onlyLowMastery || Number(item.masteryPercent ?? 0) < 60
      return matchType && matchQuery && matchDue && matchMastery
    })
  }, [dispatchMode, baseFiltered, dispatchItems, query, typeFilter, onlyDue, onlyLowMastery])

  const typeBreakdown = useMemo(() => {
    const source = dispatchMode ? dispatchItems : items
    const map: Record<string, number> = {}
    source.forEach(item => {
      const key = item.questionType || '未分类'
      map[key] = (map[key] || 0) + 1
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [items, dispatchItems, dispatchMode])

  const reasonBreakdown = useMemo(() => buildReasonBreakdown(items), [items])

  const topWeakType = typeBreakdown[0]?.[0] || ''
  const needReviewCount = useMemo(() => items.filter(item => item.nextReviewAt).length, [items])
  const lowMasteryCount = useMemo(() => items.filter(item => Number(item.masteryPercent ?? 0) < 60).length, [items])
  const nextAction = useMemo(() => buildNextAction(items), [items])

  const noteDraftCount = useMemo(() => Object.keys(noteDraftMap).length, [noteDraftMap])
  const knowledgeDraftCount = useMemo(() => Object.keys(knowledgeDraftMap).length, [knowledgeDraftMap])
  const noteSavedCount = useMemo(() => Object.keys(noteSavedMap).length, [noteSavedMap])
  const knowledgeSavedCount = useMemo(() => Object.keys(knowledgeSavedMap).length, [knowledgeSavedMap])
  const noteCompletedCount = useMemo(() => Object.keys(noteCompletedMap).length, [noteCompletedMap])
  const knowledgeCompletedCount = useMemo(() => Object.keys(knowledgeCompletedMap).length, [knowledgeCompletedMap])

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-2xl font-semibold">错题工作台</h1>

      <section className="mt-4 flex flex-wrap gap-3">
        <Link href="/wrong-questions/workbench/review" className="rounded-xl border px-4 py-2 text-sm">开始复盘流</Link>
        <Link href="/wrong-questions/workbench/retrain" className="rounded-xl border px-4 py-2 text-sm">局部重做训练</Link>
        <Link href="/wrong-questions/workbench?mode=dispatch" className={`rounded-xl px-4 py-2 text-sm ${dispatchMode ? 'bg-black text-white' : 'border'}`}>进入待处理训练队列</Link>
        <Link href="/wrong-questions/workbench" className={`rounded-xl px-4 py-2 text-sm ${!dispatchMode ? 'bg-black text-white' : 'border'}`}>查看全部错题</Link>
        <Link href="/wrong-questions/workbench/manual-entry" className="rounded-xl border px-4 py-2 text-sm">手动录入错题</Link>
        <Link href="/wrong-questions/workbench/notes" className="rounded-xl border px-4 py-2 text-sm">错题笔记联动</Link>
        <Link href="/wrong-questions/workbench/drafts" className="rounded-xl border px-4 py-2 text-sm">草稿箱</Link>
      </section>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">错题总数</p>
            <p className="mt-1 text-2xl font-semibold">{items.length}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">待复习</p>
            <p className="mt-1 text-2xl font-semibold">{needReviewCount}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">低掌握度</p>
            <p className="mt-1 text-2xl font-semibold">{lowMasteryCount}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">主要薄弱题型</p>
            <p className="mt-1 text-2xl font-semibold">{topWeakType || '-'}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border bg-amber-50 p-4 text-sm">
            <p className="font-medium">{dispatchMode ? '当前训练调度建议' : '下一步动作建议'}</p>
            <p className="mt-2 text-slate-700">
              {dispatchMode
                ? '系统已按“笔记未完成 → 挂接未完成 → 待复习 → 低掌握度 → 常规错题”的顺序为你排好处理优先级。'
                : nextAction}
            </p>
          </div>
          <div className="rounded-xl border bg-slate-50 p-4 text-sm">
            <p className="font-medium">待处理 / 已完成队列</p>
            <div className="mt-2 grid gap-1 text-slate-700">
              <p>笔记草稿：{noteDraftCount}</p>
              <p>知识点挂接草稿：{knowledgeDraftCount}</p>
              <p>已保存笔记：{noteSavedCount}</p>
              <p>已保存挂接：{knowledgeSavedCount}</p>
              <p>已完成笔记：{noteCompletedCount}</p>
              <p>已完成挂接：{knowledgeCompletedCount}</p>
              <p>待复习错题：{needReviewCount}</p>
            </div>
            {dispatchSummary ? (
              <div className="mt-3 border-t pt-3 text-slate-700">
                <p>优先补笔记：{dispatchSummary.noteFirst}</p>
                <p>优先挂知识点：{dispatchSummary.knowledgeFirst}</p>
                <p>优先清待复习：{dispatchSummary.reviewFirst}</p>
                <p>优先清低掌握度：{dispatchSummary.masteryFirst}</p>
                <p>常规错题再练：{dispatchSummary.normal}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[360px_360px_minmax(0,1fr)]">
        <aside className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">题型分布</h2>
            <span className="text-sm text-slate-500">{typeBreakdown.length} 类</span>
          </div>
          <div className="mt-4 grid gap-3">
            {typeBreakdown.length ? typeBreakdown.map(([type, count]) => (
              <button
                key={type}
                onClick={() => setTypeFilter(prev => prev === type ? 'all' : type)}
                className={`rounded-xl border p-3 text-left ${typeFilter === type ? 'border-black bg-slate-50' : 'border-slate-200'}`}
              >
                <div className="flex items-center justify-between">
                  <span>{type}</span>
                  <span className="text-sm text-slate-500">{count} 题</span>
                </div>
              </button>
            )) : <p className="text-sm text-slate-500">暂无题型数据</p>}
          </div>
        </aside>

        <aside className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">错因分布</h2>
            <span className="text-sm text-slate-500">{reasonBreakdown.length} 类</span>
          </div>
          <div className="mt-4 grid gap-3">
            {reasonBreakdown.length ? reasonBreakdown.map(([reason, count]) => (
              <div key={reason} className="rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <span>{reason}</span>
                  <span className="text-sm text-slate-500">{count} 题</span>
                </div>
              </div>
            )) : <p className="text-sm text-slate-500">暂无错因数据</p>}
          </div>
        </aside>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">{dispatchMode ? '待处理训练队列' : '错题列表'}</h2>
            <div className="flex flex-wrap gap-3">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索题干 / 错因" className="rounded-xl border px-3 py-2 text-sm" />
              <button onClick={() => setOnlyDue(prev => !prev)} className="rounded-xl border px-3 py-2 text-sm">{onlyDue ? '显示全部' : '只看待复习'}</button>
              <button onClick={() => setOnlyLowMastery(prev => !prev)} className="rounded-xl border px-3 py-2 text-sm">{onlyLowMastery ? '显示全部掌握度' : '只看低掌握度'}</button>
              <Link href="/wrong-questions" className="rounded-xl border px-4 py-2 text-sm">旧错题页</Link>
            </div>
          </div>

          {loading ? <p className="mt-4 text-sm text-slate-500">加载中...</p> : null}

          <div className="mt-4 grid gap-3">
            {!loading && !filtered.length ? <p className="text-sm text-slate-500">暂无匹配错题</p> : null}
            {(filtered as any[]).map(item => {
              const wrongId = item.id
              const questionId = item.questionId
              const statusKey = `${wrongId}__${questionId}`
              const hasNoteDraft = Boolean(noteDraftMap[statusKey])
              const hasKnowledgeDraft = Boolean(knowledgeDraftMap[statusKey])
              const hasNoteSaved = Boolean(noteSavedMap[statusKey])
              const hasKnowledgeSaved = Boolean(knowledgeSavedMap[statusKey])
              const hasNoteCompleted = Boolean(noteCompletedMap[statusKey])
              const hasKnowledgeCompleted = Boolean(knowledgeCompletedMap[statusKey])

              return (
                <div key={wrongId} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-slate-500">{item.questionType || '未分类'}</div>
                    <div className="text-sm text-slate-500">掌握度：{item.masteryPercent ?? 0}%</div>
                  </div>

                  <p className="mt-2 line-clamp-2">{item.content}</p>

                  {dispatchMode ? (
                    <div className="mt-3 rounded-xl border bg-amber-50 p-3 text-sm text-slate-700">
                      当前优先原因：{item.dispatchReason}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {hasNoteDraft ? <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">有笔记草稿</span> : null}
                    {hasKnowledgeDraft ? <span className="rounded-full bg-green-100 px-2 py-1 text-green-700">有知识点草稿</span> : null}
                    {hasNoteSaved ? <span className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700">笔记已保存</span> : null}
                    {hasKnowledgeSaved ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">挂接已保存</span> : null}
                    {hasNoteCompleted ? <span className="rounded-full bg-purple-100 px-2 py-1 text-purple-700">笔记已完成</span> : null}
                    {hasKnowledgeCompleted ? <span className="rounded-full bg-lime-100 px-2 py-1 text-lime-700">挂接已完成</span> : null}
                    {item.nextReviewAt ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">待复习</span> : null}
                  </div>

                  <div className="mt-3 grid gap-1 text-sm text-slate-600">
                    {'userAnswer' in item ? <p>我的答案：{item.userAnswer || '未作答'}</p> : null}
                    {'correctAnswer' in item ? <p>正确答案：{item.correctAnswer || '-'}</p> : null}
                    <p>错因：{item.errorReason || '待补充'}</p>
                    {'latestAnalysis' in item && item.latestAnalysis?.errorTypePrimary ? <p>系统错因：{item.latestAnalysis.errorTypePrimary}</p> : null}
                    {'latestAnalysis' in item && item.latestAnalysis?.trainingMode ? <p>训练模式：{item.latestAnalysis.trainingMode}</p> : null}
                    {'latestAnalysis' in item && item.latestAnalysis?.nextAction ? <p>下一步：{item.latestAnalysis.nextAction}</p> : null}
                    {'latestAnalysis' in item && item.latestAnalysis?.wrongStepIndex ? <p>疑似错步：第 {item.latestAnalysis.wrongStepIndex} 步</p> : null}
                    {item.nextReviewAt ? <p>下次复习：{new Date(item.nextReviewAt).toLocaleString()}</p> : null}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    {questionId ? <Link href={`/questions/${questionId}`} className="rounded-xl border px-4 py-2 text-sm">查看原题</Link> : null}
                    {questionId ? <Link href={`/practice?questionId=${questionId}`} className="rounded-xl border px-4 py-2 text-sm">再练这题</Link> : null}
                    {questionId ? <Link href={`/wrong-questions/workbench/process?questionId=${questionId}`} className="rounded-xl border px-4 py-2 text-sm">看过程回放</Link> : null}
                    {questionId ? <Link href={`/wrong-questions/workbench/retrain?questionId=${questionId}`} className="rounded-xl border px-4 py-2 text-sm">局部重做</Link> : null}
                    <Link href={`/wrong-questions/workbench/notes/edit?wrongId=${wrongId}&questionId=${questionId}&content=${encodeURIComponent(item.content)}`} className="rounded-xl border px-4 py-2 text-sm">
                      {hasNoteSaved ? '继续处理笔记' : hasNoteDraft ? '继续笔记' : '写笔记'}
                    </Link>
                    <Link href={`/wrong-questions/workbench/knowledge-link?wrongId=${wrongId}&questionId=${questionId}`} className="rounded-xl border px-4 py-2 text-sm">
                      {hasKnowledgeSaved ? '继续处理挂接' : hasKnowledgeDraft ? '继续挂接' : '挂知识点'}
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </section>
    </main>
  )
}
