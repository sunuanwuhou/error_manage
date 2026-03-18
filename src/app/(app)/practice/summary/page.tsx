'use client'
// src/app/(app)/practice/summary/page.tsx

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Summary {
  total: number
  correct: number
  accuracy: number
  newStockified: number
  slowCorrect: number
  byType: Array<{ type: string; accuracy: number; total: number }>
  stockifiedItems: Array<{ type: string; subtype?: string; masteryPercent: number }>
}

export default function SummaryPage() {
  const router      = useRouter()
  const params      = useSearchParams()
  const since       = params.get('since')
  const [data, setData] = useState<Summary | null>(null)

  useEffect(() => {
    if (!since) { router.push('/dashboard'); return }
    fetch(`/api/review/session-summary?since=${encodeURIComponent(since)}`)
      .then(r => r.json()).then(setData)
  }, [since, router])

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-gray-400">汇总中...</div>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto px-4 pt-8 pb-24">
      {/* 主标题 */}
      <div className="text-center mb-8">
        <div className="text-6xl mb-3">
          {data.newStockified > 0 ? '🏆' : data.accuracy >= 80 ? '🎉' : '💪'}
        </div>
        <h2 className="text-2xl font-bold text-gray-900">今日练习完成</h2>
        <p className="text-gray-500 mt-1">共 {data.total} 道题</p>
      </div>

      {/* 新增存量化（最重要的正反馈）*/}
      {data.newStockified > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-4 text-center">
          <p className="text-4xl font-bold text-green-600">+{data.newStockified}</p>
          <p className="text-green-700 font-semibold mt-1">道题今日存量化 ✅</p>
          <p className="text-xs text-green-600 mt-1">这些考点已稳固，不靠冲刺也能拿分</p>
          {data.stockifiedItems.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {data.stockifiedItems.map((item, i) => (
                <span key={i} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                  {item.type}{item.subtype ? ` · ${item.subtype}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 本次成绩 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <div className="grid grid-cols-3 divide-x divide-gray-100">
          {[
            { label: '正确率', value: `${data.accuracy}%`,
              color: data.accuracy >= 80 ? 'text-green-600' : data.accuracy >= 60 ? 'text-blue-600' : 'text-red-500' },
            { label: '答对',   value: `${data.correct}/${data.total}`, color: 'text-gray-900' },
            { label: '慢正确', value: data.slowCorrect,
              color: data.slowCorrect > 2 ? 'text-amber-500' : 'text-gray-400' },
          ].map(item => (
            <div key={item.label} className="text-center px-3">
              <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
        {data.slowCorrect > 2 && (
          <p className="text-xs text-amber-600 text-center mt-3 bg-amber-50 rounded-xl py-2">
            ⚠️ {data.slowCorrect} 道题超速度警戒线，实考会丢分，建议练速度
          </p>
        )}
      </div>

      {/* 题型正确率 */}
      {data.byType.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">各题型表现</h3>
          <div className="space-y-2.5">
            {data.byType.map(t => (
              <div key={t.type}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700">{t.type}</span>
                  <span className={`font-medium tabular-nums
                    ${t.accuracy >= 80 ? 'text-green-600' : t.accuracy >= 60 ? 'text-blue-600' : 'text-red-500'}`}>
                    {t.accuracy}% · {t.total}题
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width:           `${t.accuracy}%`,
                      backgroundColor: t.accuracy >= 80 ? '#16a34a' : t.accuracy >= 60 ? '#2563eb' : '#ef4444',
                    }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部按钮 */}
      <div className="space-y-3">
        <Link href="/dashboard"
          className="block w-full py-4 bg-blue-600 text-white font-bold rounded-2xl text-center text-base">
          返回首页
        </Link>
        <Link href="/stats"
          className="block w-full py-3 border border-gray-200 text-gray-600 font-medium rounded-2xl text-center text-sm">
          查看总进度
        </Link>
      </div>
    </div>
  )
}
