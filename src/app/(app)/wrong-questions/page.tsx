'use client'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type ErrorItem = {
  id: string
  myAnswer: string
  errorReason?: string | null
  updatedAt: string
  question: {
    id: string
    content: string
    type: string
    answer: string
    options?: string | null
    questionImage?: string | null
  }
}

function parseOptions(raw?: string | null) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default function WrongQuestionsPage() {
  const [items, setItems] = useState<ErrorItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    const res = await fetch(`/api/errors?${params.toString()}`)
    const payload = await res.json()
    setItems(payload.items || [])
    setLoading(false)
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [])

  const summary = useMemo(() => {
    const byType: Record<string, number> = {}
    for (const item of items) {
      byType[item.question.type || '未分类'] = (byType[item.question.type || '未分类'] || 0) + 1
    }
    return byType
  }, [items])

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">错题本</h1>
      <div className="mt-4 flex gap-3">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜索题干"
          className="flex-1 rounded-xl border px-3 py-2"
        />
        <button onClick={() => load()} className="rounded-xl bg-black px-4 py-2 text-white">
          搜索
        </button>
      </div>

      {Object.keys(summary).length ? (
        <section className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm">
          <div className="flex flex-wrap gap-3">
            <span className="font-medium">总错题：{items.length}</span>
            {Object.entries(summary).map(([key, value]) => (
              <span key={key} className="rounded-full border bg-white px-3 py-1">
                {key}：{value}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? <p className="mt-6 text-slate-500">加载中...</p> : null}
      <div className="mt-6 grid gap-4">
        {items.map(item => (
          <article key={item.id} className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>{item.question.type}</span>
              <span>{new Date(item.updatedAt).toLocaleString()}</span>
            </div>
            <h2 className="mt-2 whitespace-pre-wrap text-base font-medium">{item.question.content}</h2>
            {item.question.questionImage ? (
              <img src={item.question.questionImage} alt="题目图片" className="mt-3 max-h-80 rounded-xl border" />
            ) : null}
            <div className="mt-3 grid gap-2">
              {parseOptions(item.question.options).map((option: string, index: number) => (
                <div key={index} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  {option}
                </div>
              ))}
            </div>
            <div className="mt-4 text-sm">
              <p>我的答案：{item.myAnswer || '未填写'}</p>
              <p className="mt-1">正确答案：{item.question.answer}</p>
              {item.errorReason ? <p className="mt-1 text-red-700">错因：{item.errorReason}</p> : null}
            </div>
            <div className="mt-4 flex gap-3">
              <Link href={`/questions/${item.question.id}`} className="rounded-xl border px-3 py-2 text-sm">
                查看原题
              </Link>
              <Link href={`/practice?questionId=${item.question.id}`} className="rounded-xl border px-3 py-2 text-sm">
                再练这题
              </Link>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
