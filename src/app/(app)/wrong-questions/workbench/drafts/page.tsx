'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { listAllDrafts, removeDraft, type DraftRecord } from '@/lib/wrong-workbench-drafts'

export default function WrongWorkbenchDraftsPage() {
  const [items, setItems] = useState<DraftRecord[]>([])

  function load() {
    setItems(listAllDrafts())
  }

  useEffect(() => {
    load()
  }, [])

  const noteDrafts = useMemo(() => items.filter(item => item.type === 'note'), [items])
  const knowledgeDrafts = useMemo(() => items.filter(item => item.type === 'knowledge'), [items])

  function renderItem(item: DraftRecord) {
    const href = item.type === 'note'
      ? `/wrong-questions/workbench/notes/edit?wrongId=${item.wrongId}&questionId=${item.questionId}`
      : `/wrong-questions/workbench/knowledge-link?wrongId=${item.wrongId}&questionId=${item.questionId}`

    return (
      <div key={item.key} className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>{item.type === 'note' ? '笔记草稿' : '知识点挂接草稿'}</span>
          <span>{new Date(item.updatedAt).toLocaleString()}</span>
        </div>

        <div className="mt-3 text-sm text-slate-700">
          <p>wrongId：{item.wrongId || '-'}</p>
          <p>questionId：{item.questionId || '-'}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={href} className="rounded-xl border px-4 py-2 text-sm">继续编辑</Link>
          <button
            onClick={() => {
              removeDraft(item.key)
              load()
            }}
            className="rounded-xl border px-4 py-2 text-sm"
          >
            删除草稿
          </button>
        </div>
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">错题工作台草稿箱</h1>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          这里承接“笔记草稿”和“知识点挂接草稿”。这样你从错题出发写到一半，不会直接丢失，后面可以继续补。
        </p>
      </section>

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="grid gap-3">
          <h2 className="text-lg font-medium">笔记草稿</h2>
          {!noteDrafts.length ? <p className="text-sm text-slate-500">暂无笔记草稿</p> : null}
          {noteDrafts.map(renderItem)}
        </div>

        <div className="grid gap-3">
          <h2 className="text-lg font-medium">知识点挂接草稿</h2>
          {!knowledgeDrafts.length ? <p className="text-sm text-slate-500">暂无知识点挂接草稿</p> : null}
          {knowledgeDrafts.map(renderItem)}
        </div>
      </section>
    </main>
  )
}
