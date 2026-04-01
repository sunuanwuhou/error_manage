'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type WrongItem = {
  id: string
  questionId: string
  content: string
  questionType?: string
  errorReason?: string
  masteryPercent?: number
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

export default function WrongQuestionsNotesLinkPage() {
  const [items, setItems] = useState<WrongItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [noteSavedMap, setNoteSavedMap] = useState<Record<string, boolean>>({})
  const [knowledgeSavedMap, setKnowledgeSavedMap] = useState<Record<string, boolean>>({})
  const [noteCompletedMap, setNoteCompletedMap] = useState<Record<string, boolean>>({})
  const [knowledgeCompletedMap, setKnowledgeCompletedMap] = useState<Record<string, boolean>>({})

  async function loadData() {
    setLoading(true)
    try {
      const [wrongRes, noteRes, knowledgeRes] = await Promise.all([
        fetch('/api/wrong-questions'),
        fetch('/api/wrong-questions/workbench/notes'),
        fetch('/api/wrong-questions/workbench/knowledge-links'),
      ])
      const wrongData = await wrongRes.json()
      const noteData = await noteRes.json()
      const knowledgeData = await knowledgeRes.json()

      const next = (wrongData.items || []).map((item: any) => ({
        id: item.id,
        questionId: item.questionId || item.question?.id || '',
        content: item.question?.content || item.content || '',
        questionType: item.question?.type || item.questionType || '未分类',
        errorReason: item.errorReason || '',
        masteryPercent: item.masteryPercent ?? 0,
      }))
      setItems(next)

      const noteMaps = buildStatusMap((noteData.items || []) as NoteRecord[])
      const knowledgeMaps = buildStatusMap((knowledgeData.items || []) as KnowledgeRecord[])
      setNoteSavedMap(noteMaps.savedMap)
      setNoteCompletedMap(noteMaps.completedMap)
      setKnowledgeSavedMap(knowledgeMaps.savedMap)
      setKnowledgeCompletedMap(knowledgeMaps.completedMap)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData().catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(item => !q || item.content.toLowerCase().includes(q) || String(item.errorReason || '').toLowerCase().includes(q))
  }, [items, query])

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold">错题—笔记联动</h1>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            这里承接错题与笔记、知识点、再练动作的联动。当前版本已开始接入服务端保存状态，不再只是本地入口。
          </p>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索错题 / 错因" className="rounded-xl border px-3 py-2 text-sm" />
        </div>
      </section>

      <section className="mt-6 grid gap-3">
        {loading ? <p className="text-sm text-slate-500">加载中...</p> : null}
        {!loading && !filtered.length ? <p className="text-sm text-slate-500">暂无可联动错题</p> : null}

        {filtered.map(item => {
          const statusKey = `${item.id}__${item.questionId}`
          const hasNoteSaved = Boolean(noteSavedMap[statusKey])
          const hasKnowledgeSaved = Boolean(knowledgeSavedMap[statusKey])
          const hasNoteCompleted = Boolean(noteCompletedMap[statusKey])
          const hasKnowledgeCompleted = Boolean(knowledgeCompletedMap[statusKey])

          return (
            <div key={item.id} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
                <span>{item.questionType || '未分类'}</span>
                <span>掌握度：{item.masteryPercent ?? 0}%</span>
              </div>
              <p className="mt-2 line-clamp-2">{item.content}</p>
              <p className="mt-2 text-sm text-slate-600">错因：{item.errorReason || '待补充'}</p>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {hasNoteSaved ? <span className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700">笔记已保存</span> : null}
                {hasKnowledgeSaved ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">挂接已保存</span> : null}
                {hasNoteCompleted ? <span className="rounded-full bg-purple-100 px-2 py-1 text-purple-700">笔记已完成</span> : null}
                {hasKnowledgeCompleted ? <span className="rounded-full bg-lime-100 px-2 py-1 text-lime-700">挂接已完成</span> : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                {item.questionId ? <Link href={`/questions/${item.questionId}`} className="rounded-xl border px-4 py-2 text-sm">查看原题</Link> : null}
                {item.questionId ? <Link href={`/practice?questionId=${item.questionId}`} className="rounded-xl border px-4 py-2 text-sm">再练这题</Link> : null}
                <Link href={`/wrong-questions/workbench/notes/edit?wrongId=${item.id}&questionId=${item.questionId}&content=${encodeURIComponent(item.content)}`} className="rounded-xl border px-4 py-2 text-sm">
                  {hasNoteSaved ? '继续处理笔记' : '写笔记'}
                </Link>
                <Link href={`/wrong-questions/workbench/knowledge-link?wrongId=${item.id}&questionId=${item.questionId}`} className="rounded-xl border px-4 py-2 text-sm">
                  {hasKnowledgeSaved ? '继续处理挂接' : '挂知识点'}
                </Link>
              </div>
            </div>
          )
        })}
      </section>
    </main>
  )
}
