'use client'
// src/app/(app)/search/page.tsx — 题目搜索（B5）

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface SearchResult {
  id: string; content: string; type: string; subtype?: string
  answer: string; examType: string; srcYear?: string
}

export default function SearchPage() {
  const router    = useRouter()
  const inputRef  = useRef<HTMLInputElement>(null)
  const [q, setQ]             = useState('')
  const [type, setType]       = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<NodeJS.Timeout>()

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    clearTimeout(timerRef.current)
    if (!q.trim() && !type) { setResults([]); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (type)     params.set('type', type)
      params.set('limit', '30')
      const res  = await fetch(`/api/questions?${params}`)
      const data = await res.json()
      setResults(Array.isArray(data) ? data : [])
      setLoading(false)
    }, 300)
  }, [q, type])

  async function addToErrors(questionId: string) {
    const res = await fetch('/api/errors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId, myAnswer: 'A', fromSearch: true }),
    })
    if (res.ok || res.status === 409) {
      router.push('/errors')
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center">←</button>
        <h1 className="text-xl font-bold text-gray-900">搜索题目</h1>
      </div>

      <div className="sticky top-0 bg-gray-50 pb-3 space-y-2 z-10">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="搜索题目内容关键词..."
            className="w-full pl-9 pr-4 py-3 border border-gray-200 bg-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 text-lg">×</button>}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['', '判断推理', '言语理解', '数量关系', '资料分析', '常识判断'].map(t => (
            <button key={t} onClick={() => setType(t)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs border transition-colors
                ${type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200'}`}>
              {t || '全部题型'}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-center py-8 text-gray-400 text-sm">搜索中...</div>}

      {!loading && results.length === 0 && (q || type) && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">🔍</p>
          <p className="text-sm">没有找到匹配的题目</p>
        </div>
      )}

      {!loading && !q && !type && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">🔍</p>
          <p className="text-sm">输入关键词搜索题目</p>
          <p className="text-xs mt-1">支持题目内容、考点名称</p>
        </div>
      )}

      <div className="space-y-3 mt-2">
        {results.map(r => (
          <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-lg">{r.type}{r.subtype ? ` · ${r.subtype}` : ''}</span>
              {r.srcYear && <span className="text-xs text-gray-400">{r.srcYear}</span>}
              <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded">答：{r.answer}</span>
            </div>
            <p className="text-sm text-gray-700 line-clamp-3 mb-3">{r.content}</p>
            <button onClick={() => addToErrors(r.id)}
              className="w-full py-2 border border-blue-200 text-blue-600 text-sm rounded-xl hover:bg-blue-50 transition-colors">
              加入错题本
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
