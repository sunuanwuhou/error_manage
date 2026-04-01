'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

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
}

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

export default function WrongWorkbenchReviewFlowPage() {
  const [items, setItems] = useState<DispatchItem[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [noteSavedMap, setNoteSavedMap] = useState<Record<string, boolean>>({})
  const [knowledgeSavedMap, setKnowledgeSavedMap] = useState<Record<string, boolean>>({})
  const [noteCompletedMap, setNoteCompletedMap] = useState<Record<string, boolean>>({})
  const [knowledgeCompletedMap, setKnowledgeCompletedMap] = useState<Record<string, boolean>>({})

  async function loadData() {
    setLoading(true)
    try {
      const [dispatchRes, noteRes, knowledgeRes] = await Promise.all([
        fetch('/api/wrong-questions/workbench/training-dispatch'),
        fetch('/api/wrong-questions/workbench/notes'),
        fetch('/api/wrong-questions/workbench/knowledge-links'),
      ])

      const dispatchData = await dispatchRes.json()
      const noteData = await noteRes.json()
      const knowledgeData = await knowledgeRes.json()

      setItems(dispatchData.items || [])

      const noteMaps = buildStatusMap((noteData.items || []) as NoteRecord[])
      const knowledgeMaps = buildStatusMap((knowledgeData.items || []) as KnowledgeRecord[])
      setNoteSavedMap(noteMaps.savedMap)
      setKnowledgeSavedMap(knowledgeMaps.savedMap)
      setNoteCompletedMap(noteMaps.completedMap)
      setKnowledgeCompletedMap(knowledgeMaps.completedMap)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData().catch(() => setLoading(false))
  }, [])

  const current = items[index] || null
  const progressText = useMemo(() => items.length ? `${index + 1} / ${items.length}` : '0 / 0', [index, items.length])

  function statusKey(item: DispatchItem | null) {
    if (!item) return ''
    return `${item.id}__${item.questionId}`
  }

  const key = statusKey(current)
  const hasNoteSaved = Boolean(noteSavedMap[key])
  const hasKnowledgeSaved = Boolean(knowledgeSavedMap[key])
  const hasNoteCompleted = Boolean(noteCompletedMap[key])
  const hasKnowledgeCompleted = Boolean(knowledgeCompletedMap[key])

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">本轮复盘流</h1>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">当前进度</p>
            <p className="mt-1 text-lg font-semibold">{progressText}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/wrong-questions/workbench?mode=dispatch" className="rounded-xl border px-4 py-2 text-sm">回待处理训练队列</Link>
            <Link href="/wrong-questions/workbench" className="rounded-xl border px-4 py-2 text-sm">回错题工作台</Link>
          </div>
        </div>
      </section>

      {loading ? <p className="mt-6 text-sm text-slate-500">加载中...</p> : null}
      {!loading && !current ? <p className="mt-6 text-sm text-slate-500">当前没有可复盘的错题。</p> : null}

      {current ? (
        <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
            <span>{current.questionType || '未分类'}</span>
            <span>掌握度：{current.masteryPercent ?? 0}%</span>
          </div>

          <div className="rounded-xl border bg-amber-50 p-4 text-sm text-slate-700">
            当前优先原因：{current.dispatchReason}
          </div>

          <p className="mt-4 whitespace-pre-wrap text-lg">{current.content}</p>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {hasNoteSaved ? <span className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700">笔记已保存</span> : null}
            {hasKnowledgeSaved ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">挂接已保存</span> : null}
            {hasNoteCompleted ? <span className="rounded-full bg-purple-100 px-2 py-1 text-purple-700">笔记已完成</span> : null}
            {hasKnowledgeCompleted ? <span className="rounded-full bg-lime-100 px-2 py-1 text-lime-700">挂接已完成</span> : null}
            {current.nextReviewAt ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">待复习</span> : null}
          </div>

          <div className="mt-4 grid gap-1 text-sm text-slate-600">
            <p>错因：{current.errorReason || '待补充'}</p>
            {current.nextReviewAt ? <p>下次复习：{new Date(current.nextReviewAt).toLocaleString()}</p> : null}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/questions/${current.questionId}`} className="rounded-xl border px-4 py-2 text-sm">查看原题</Link>
            <Link href={`/practice?questionId=${current.questionId}`} className="rounded-xl border px-4 py-2 text-sm">再练这题</Link>
            <Link href={`/wrong-questions/workbench/process?questionId=${current.questionId}`} className="rounded-xl border px-4 py-2 text-sm">看过程回放</Link>
            <Link
              href={`/wrong-questions/workbench/notes/edit?wrongId=${current.id}&questionId=${current.questionId}&content=${encodeURIComponent(current.content)}`}
              className="rounded-xl border px-4 py-2 text-sm"
            >
              {hasNoteSaved ? '继续处理笔记' : '写笔记'}
            </Link>
            <Link
              href={`/wrong-questions/workbench/knowledge-link?wrongId=${current.id}&questionId=${current.questionId}`}
              className="rounded-xl border px-4 py-2 text-sm"
            >
              {hasKnowledgeSaved ? '继续处理挂接' : '挂知识点'}
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => setIndex(prev => Math.max(0, prev - 1))}
              disabled={index <= 0}
              className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
            >
              上一题
            </button>
            <button
              onClick={() => setIndex(prev => Math.min(items.length - 1, prev + 1))}
              disabled={index >= items.length - 1}
              className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              下一题
            </button>
          </div>
        </section>
      ) : null}
    </main>
  )
}
