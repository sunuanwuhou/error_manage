'use client'
// src/app/(app)/anchors/page.tsx
// 考前1小时：快速过记忆锚点（5秒/条，不出题）

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface AnchorItem {
  id: string
  type: string
  subtype?: string
  anchor: string
  mastery: number
}

export default function AnchorsPage() {
  const router        = useRouter()
  const [items, setItems] = useState<AnchorItem[]>([])
  const [idx, setIdx]     = useState(0)
  const [done, setDone]   = useState(false)
  const [loading, setLoading] = useState(true)
  const [autoPlay, setAutoPlay] = useState(false)
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    fetch('/api/anchors').then(r => r.json()).then(data => {
      setItems(data); setLoading(false)
    })
  }, [])

  // 自动播放倒计时
  useEffect(() => {
    if (!autoPlay || done || loading) return
    if (countdown <= 0) {
      handleNext()
      return
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [autoPlay, countdown, done, loading])

  const handleNext = useCallback(() => {
    if (idx >= items.length - 1) { setDone(true); return }
    setIdx(i => i + 1)
    setCountdown(5)
  }, [idx, items.length])

  const handlePrev = () => {
    if (idx <= 0) return
    setIdx(i => i - 1)
    setCountdown(5)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">加载中...</div>
  )

  if (items.length === 0) return (
    <div className="max-w-lg mx-auto px-4 pt-16 text-center">
      <p className="text-4xl mb-3">📭</p>
      <p className="text-gray-500 font-medium">还没有存量化的考点</p>
      <p className="text-sm text-gray-400 mt-1">先去练题，等第一道题存量化后再来</p>
      <button onClick={() => router.push('/practice')}
        className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-2xl font-medium">
        去练题
      </button>
    </div>
  )

  if (done) return (
    <div className="max-w-lg mx-auto px-4 pt-16 text-center">
      <div className="text-6xl mb-4">✅</div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">口诀全部过完！</h2>
      <p className="text-gray-500">共 {items.length} 个已稳固考点</p>
      <p className="text-sm text-gray-400 mt-1">考场见到类似题，口诀会自然浮现</p>
      <div className="flex gap-3 mt-8">
        <button onClick={() => { setIdx(0); setDone(false); setCountdown(5) }}
          className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-2xl font-medium">
          再过一遍
        </button>
        <button onClick={() => router.push('/dashboard')}
          className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-bold">
          返回首页
        </button>
      </div>
    </div>
  )

  const current = items[idx]

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
      {/* 进度 */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 min-h-[44px] min-w-[44px] flex items-center text-xl">←</button>
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${((idx + 1) / items.length) * 100}%` }} />
        </div>
        <span className="text-sm text-gray-400 tabular-nums">{idx + 1}/{items.length}</span>
      </div>

      {/* 标题 */}
      <div className="text-center mb-8">
        <h1 className="text-xl font-bold text-gray-900">快速过口诀</h1>
        <p className="text-sm text-gray-400 mt-1">考前记忆激活 · 不做题，只看口诀</p>
      </div>

      {/* 考点 + 口诀卡片 */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-lg p-8 mb-6 min-h-[200px] flex flex-col items-center justify-center text-center">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs bg-blue-100 text-blue-600 px-3 py-1 rounded-full font-medium">
            {current.type}
          </span>
          {current.subtype && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">
              {current.subtype}
            </span>
          )}
          <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded-full">
            ✅ {current.mastery}%
          </span>
        </div>
        <p className="text-2xl font-bold text-gray-900 leading-relaxed">{current.anchor}</p>
      </div>

      {/* 自动播放控制 */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <button
          onClick={() => { setAutoPlay(!autoPlay); setCountdown(5) }}
          className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors
            ${autoPlay ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
        >
          {autoPlay ? `自动 ${countdown}s` : '自动播放'}
        </button>
        <span className="text-xs text-gray-400">5秒/条</span>
      </div>

      {/* 手动翻页 */}
      <div className="flex gap-3">
        <button onClick={handlePrev} disabled={idx === 0}
          className="flex-1 py-4 border border-gray-200 text-gray-600 font-medium rounded-2xl disabled:opacity-30">
          ← 上一条
        </button>
        <button onClick={handleNext}
          className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl">
          {idx === items.length - 1 ? '完成 ✓' : '下一条 →'}
        </button>
      </div>
    </div>
  )
}
