'use client'
// src/components/stats/exam-strategy-card.tsx
// 考场答题顺序策略（§0.7④）

import { useEffect, useState } from 'react'

interface StrategyItem {
  section:        string
  stockifiedRate: number
  stockified:     number
  total:          number
  suggestion:     string
  color:          string
}

export function ExamStrategyCard() {
  const [items, setItems]   = useState<StrategyItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/stats/exam-strategy').then(r => r.json()).then(data => {
      setItems(data); setLoading(false)
    })
  }, [])

  if (loading) return <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />
  if (items.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-gray-700">🎯 考场答题顺序建议</h2>
        <span className="text-xs text-gray-400">基于当前掌握度</span>
      </div>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={item.section} className="flex items-center gap-3">
            <span className="w-5 h-5 rounded-full bg-gray-100 text-xs flex items-center justify-center font-bold text-gray-500 flex-shrink-0">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm text-gray-700 font-medium">{item.section}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.color}`}>
                  {item.suggestion}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    width: `${item.stockifiedRate * 100}%`,
                    backgroundColor: item.stockifiedRate >= 0.7 ? '#16a34a' : item.stockifiedRate >= 0.4 ? '#2563eb' : '#9ca3af'
                  }} />
                </div>
                <span className="text-xs text-gray-400 tabular-nums w-16 text-right">
                  稳固 {item.stockified}/{item.total}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-3">
        💡 稳固率高的题型先做，稳拿分后再攻难点
      </p>
    </div>
  )
}
