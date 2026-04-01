'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type QuestionPayload = {
  id: string
  content: string
  options?: string | null
  answer: string
  analysis?: string | null
  type: string
  questionImage?: string | null
  srcYear?: string | null
  srcProvince?: string | null
  examType?: string | null
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

export default function QuestionDetailPage({ params }: { params: { id: string } }) {
  const [item, setItem] = useState<QuestionPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await fetch(`/api/questions/${params.id}`)
      const data = await res.json()
      if (res.ok) setItem(data.item || null)
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [params.id])

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">原题详情</h1>
        <div className="flex gap-3">
          {item ? (
            <Link href={`/practice?questionId=${item.id}`} className="rounded-xl border px-4 py-2 text-sm">
              开始练习
            </Link>
          ) : null}
          <Link href="/wrong-questions" className="rounded-xl border px-4 py-2 text-sm">
            返回错题本
          </Link>
        </div>
      </div>

      {loading ? <p className="mt-6 text-slate-500">加载中...</p> : null}
      {!loading && !item ? <p className="mt-6 text-red-600">未找到题目</p> : null}

      {item ? (
        <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap gap-3 text-sm text-slate-500">
            <span>{item.type}</span>
            <span>{item.srcYear || '未知年份'}</span>
            <span>{item.srcProvince || '未知地区'}</span>
            <span>{item.examType || '未知考试'}</span>
          </div>
          <h2 className="mt-3 whitespace-pre-wrap text-lg font-medium">{item.content}</h2>
          {item.questionImage ? (
            <img src={item.questionImage} alt="题图" className="mt-4 max-h-96 rounded-xl border" />
          ) : null}
          <div className="mt-4 grid gap-2">
            {parseOptions(item.options).map((opt: string, idx: number) => (
              <div key={idx} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                {opt}
              </div>
            ))}
          </div>
          <div className="mt-4 text-sm">
            <p>正确答案：{item.answer}</p>
            {item.analysis ? (
              <p className="mt-2 whitespace-pre-wrap text-slate-700">解析：{item.analysis}</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  )
}
