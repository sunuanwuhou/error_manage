'use client'
// src/app/(app)/practice/special/page.tsx
// B1: 计时训练模式 + B2: 同错因聚焦模式

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface ModeItem {
  userErrorId: string; questionId: string
  masteryPercent: number; questionType: string
  isHot: boolean; reviewCount: number
  question: { content: string; questionImage?: string | null; type: string; options: string; answer: string; sharedAiAnalysis?: string }
  aiActionRule?: string
}

interface TagItem { tag: string; count: number }

function formatQuestionContent(content: string, hasImage: boolean) {
  if (!content) return ''
  const next = hasImage
    ? content.replace(/(\[图\]|@t\d+)/gi, '').trim()
    : content.replace(/@t\d+/gi, '[图]')
  const fixed = next.replace(
    /每个办事窗口办理每笔业务的用时缩短到以前的$/g,
    '每个办事窗口办理每笔业务的用时缩短到以前的2/3'
  ).replace(
    /每个办事窗口办理每笔业务的用时缩短到以前的\[图\]/gi,
    '每个办事窗口办理每笔业务的用时缩短到以前的2/3'
  )
  return fixed || (hasImage ? '请结合图片作答。' : content)
}

export default function SpecialModesPage() {
  const router  = useRouter()
  const params  = useSearchParams()
  const mode    = params.get('mode') as 'timed' | 'focused' | null
  const tag     = params.get('tag')

  const [tags, setTags]   = useState<TagItem[]>([])
  const [items, setItems] = useState<ModeItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!mode) {
      // 首页：列出可用错因
      fetch('/api/practice/modes')
        .then(async r => {
          const data = await r.json()
          if (!r.ok) throw new Error(data.error ?? '专项模式加载失败')
          setTags(Array.isArray(data) ? data : [])
          setLoading(false)
        })
        .catch(() => setLoading(false))
    } else {
      const url = `/api/practice/modes?mode=${mode}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`
      fetch(url)
        .then(async r => {
          const data = await r.json()
          if (!r.ok) throw new Error(data.error ?? '专项题目加载失败')
          setItems(data.items ?? [])
          setLoading(false)
        })
        .catch(() => setLoading(false))
    }
  }, [mode, tag])

  // 入口页：选择模式
  if (!mode) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center">←</button>
          <h1 className="text-xl font-bold text-gray-900">专项训练</h1>
        </div>

        {/* B1: 计时训练 */}
        <Link href="/practice/special?mode=timed"
          className="block bg-white border-2 border-amber-200 rounded-2xl p-5 mb-4 hover:bg-amber-50 transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">⏱️</span>
            <span className="font-bold text-gray-900">计时训练模式</span>
            <span className="text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">提速</span>
          </div>
          <p className="text-sm text-gray-500">针对连续"慢正确"的题，限时 60% 警戒线，专项提速</p>
          <p className="text-xs text-gray-400 mt-1">答对但超时 = 实考等于丢分</p>
        </Link>

        {/* B2: 同错因聚焦 */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🎯</span>
            <span className="font-bold text-gray-900">同错因聚焦模式</span>
          </div>
          <p className="text-sm text-gray-500 mb-4">集中击破同一类错误，5-8题连续练习</p>

          {loading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : tags.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-3">还没有足够的错因数据</p>
          ) : (
            <div className="space-y-2">
              {tags.slice(0, 6).map(t => (
                <Link key={t.tag} href={`/practice/special?mode=focused&tag=${encodeURIComponent(t.tag!)}`}
                  className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl hover:bg-blue-50 transition-colors">
                  <span className="text-sm text-gray-700">{t.tag}</span>
                  <span className="text-xs bg-red-100 text-red-500 px-2 py-0.5 rounded-full">{t.count} 道</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen text-gray-400">加载中...</div>

  if (items.length === 0) return (
    <div className="max-w-lg mx-auto px-4 pt-16 text-center">
      <p className="text-4xl mb-3">✅</p>
      <p className="text-gray-600 font-medium">
        {mode === 'timed' ? '没有需要提速的题目了！' : '这个错因的题都已改善'}
      </p>
      <button onClick={() => router.back()} className="mt-6 px-6 py-3 border border-gray-200 rounded-2xl text-gray-600">返回</button>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center">←</button>
        <div>
          <h1 className="text-lg font-bold text-gray-900">
            {mode === 'timed' ? '⏱️ 计时训练' : `🎯 ${tag} 专项`}
          </h1>
          <p className="text-xs text-gray-400">共 {items.length} 道题</p>
        </div>
      </div>

      {mode === 'timed' && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-4 text-sm text-amber-700">
          ⏱️ 计时训练：每题限时为警戒线的 60%，在限时内答对才算过关
        </div>
      )}

      {/* 题目列表预览（点击进入练习） */}
      <div className="mb-6 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {items.map((item, i) => {
          const displayContent = formatQuestionContent(item.question.content, Boolean(item.question.questionImage))
          return (
            <div key={item.userErrorId} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 lg:p-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-400">#{i+1}</span>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-lg">{item.questionType}</span>
                <span className="text-xs text-gray-400">mastery {item.masteryPercent}%</span>
                {item.isHot && <span className="text-xs text-red-500">🔥</span>}
              </div>
              {item.question.questionImage && (
                <img src={item.question.questionImage} alt="题目预览图" className="mb-3 w-full rounded-xl border border-gray-100 object-contain lg:h-48" />
              )}
              <p className="text-sm text-gray-700 line-clamp-3">{displayContent}</p>
            </div>
          )
        })}
      </div>

      <Link href={`/practice/focused?mode=${mode}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
        className="block w-full rounded-2xl bg-blue-600 py-4 text-center text-base font-bold text-white lg:sticky lg:bottom-6">
        开始专项训练 →
      </Link>
    </div>
  )
}
