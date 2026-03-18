'use client'
// src/components/stats/error-patterns-card.tsx

import { useEffect, useState } from 'react'

interface Pattern {
  type: string
  tag: string
  count: number
  percentage: number
  advice: string
}
interface PatternsData {
  insufficient?: boolean
  count?: number
  needed?: number
  total?: number
  patterns?: Pattern[]
}

export function ErrorPatternsCard() {
  const [data, setData]     = useState<PatternsData | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/error-patterns').then(r => r.json()).then(setData)
  }, [])

  if (!data) return <div className="h-24 bg-gray-100 rounded-2xl animate-pulse mb-4" />

  if (data.insufficient) {
    return (
      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4 mb-4 text-center">
        <p className="text-sm font-medium text-gray-600">📊 错误陷阱分析</p>
        <p className="text-xs text-gray-400 mt-1">
          还需再错 {(data.needed ?? 30) - (data.count ?? 0)} 道题才能开启分析（当前 {data.count} 条）
        </p>
      </div>
    )
  }

  if (!data.patterns?.length) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-gray-700">🪤 错误陷阱分析</h2>
        <span className="text-xs text-gray-400">最近 {data.total} 道错题</span>
      </div>
      <div className="space-y-3">
        {data.patterns.map((p, i) => (
          <div key={i} className="border border-gray-50 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === i ? null : i)}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-xs font-bold text-red-600 flex-shrink-0">
                {p.percentage}%
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{p.type} · {p.tag}</p>
                <p className="text-xs text-gray-400">{p.count} 次</p>
              </div>
              <span className="text-gray-300 text-sm">{expanded === i ? '▲' : '▼'}</span>
            </button>
            {expanded === i && (
              <div className="px-3 pb-3 bg-amber-50 border-t border-amber-100">
                <p className="text-xs text-amber-700 mt-2">💡 {p.advice}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
