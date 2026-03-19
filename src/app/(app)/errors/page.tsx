'use client'
// src/app/(app)/errors/page.tsx — 错题本列表

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getQuestionState, STATE_LABELS } from '@/lib/mastery-engine'
import { StateBadge } from '@/components/practice/state-badge'

interface ErrorItem {
  id: string
  masteryPercent: number
  isStockified: boolean
  isHot: boolean
  reviewCount: number
  nextReviewAt: string
  errorReason?: string
  question: {
    id: string
    content: string
    questionImage?: string | null
    type: string
    subtype?: string
    answer: string
  }
}

const FILTERS = [
  { label: '全部',   value: '' },
  { label: '攻坚中', value: 'active' },
  { label: '已稳固', value: 'stockified' },
]

const TYPE_FILTERS = ['', '判断推理', '言语理解', '数量关系', '资料分析', '常识判断']

export default function ErrorsPage() {
  const [items, setItems]     = useState<ErrorItem[]>([])
  const [search, setSearch]   = useState('')
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [status, setStatus]   = useState('')
  const [type, setType]       = useState('')
  const [page, setPage]       = useState(1)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (type)   params.set('type', type)
    if (search)  params.set('q', search)
    params.set('page', String(page))

    fetch(`/api/errors?${params}`)
      .then(r => r.json())
      .then(data => { setItems(data.items); setTotal(data.total); setLoading(false) })
  }, [status, type, page, search])

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">错题本</h1>
        <div className="flex gap-2">
          <Link href="/import" className="border border-gray-200 text-gray-600 text-sm px-3 py-2 rounded-xl font-medium min-h-[44px] flex items-center">📂 导入</Link>
          <Link href="/errors/batch" className="border border-blue-600 text-blue-600 text-sm px-3 py-2 rounded-xl font-medium min-h-[44px] flex items-center">批量</Link>
          <Link href="/errors/new" className="bg-blue-600 text-white text-sm px-3 py-2 rounded-xl font-medium min-h-[44px] flex items-center">+ 单题</Link>
        </div>
      </div>

      {/* B5: 搜索框 */}
      <div className="mb-3">
        <input
          type="search" placeholder="搜索题目内容..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        />
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => { setStatus(f.value); setPage(1) }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm border transition-colors
              ${status === f.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 题型筛选 */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {TYPE_FILTERS.map(t => (
          <button
            key={t}
            onClick={() => { setType(t); setPage(1) }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs border transition-colors
              ${type === t
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-500 border-gray-100'}`}
          >
            {t || '全部题型'}
          </button>
        ))}
      </div>

      {/* 统计 */}
      <p className="text-sm text-gray-400 mb-3">共 {total} 道错题</p>

      {/* 列表 */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📭</p>
          <p>还没有错题</p>
          <Link href="/errors/new" className="inline-block mt-3 text-blue-500 text-sm underline">
            录入第一道错题
          </Link>
        </div>
      ) : (
        <div className="space-y-3 pb-6">
          {items.map(item => {
            const state = getQuestionState({
              masteryPercent: item.masteryPercent,
              isStockified: item.isStockified,
              daysToExam: null,
            })
            const isOverdue = new Date(item.nextReviewAt) <= new Date()

            return (
              <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                {/* 题型 + 状态 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg">
                      {item.question.type}
                      {item.question.subtype ? ` · ${item.question.subtype}` : ''}
                    </span>
                    {item.isHot && <span className="text-xs text-red-500 font-medium">🔥 连续出错</span>}
                    {isOverdue && !item.isStockified && (
                      <span className="text-xs text-orange-500 font-medium">待复习</span>
                    )}
                  </div>
                  <StateBadge state={state} masteryPercent={item.masteryPercent} size="sm" />
                </div>

                {/* 题目预览 */}
                {item.question.questionImage && (
                  <img
                    src={item.question.questionImage}
                    alt="题目图片"
                    className="mb-2 w-full rounded-xl border border-gray-100"
                  />
                )}
                <p className="text-sm text-gray-700 line-clamp-2 mb-2">
                  {item.question.content}
                </p>

                {/* 底部信息 */}
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>复习 {item.reviewCount} 次</span>
                  {item.errorReason && (
                    <span className="truncate max-w-[180px]">原因：{item.errorReason}</span>
                  )}
                </div>
                <div className="mt-3 flex justify-end">
                  <Link
                    href={`/notes?draft=1&draftKind=notes&draftType=${encodeURIComponent(item.question.type)}&draftSubtype=${encodeURIComponent('错题复盘')}&draftTitle=${encodeURIComponent(`${item.question.type}${item.question.subtype ? ` · ${item.question.subtype}` : ''}复盘`)}&draftContent=${encodeURIComponent([
                      `题目：${item.question.content.slice(0, 80)}`,
                      item.errorReason ? `这次错因：${item.errorReason}` : '',
                      `当前掌握度：${item.masteryPercent}%`,
                      isOverdue ? '状态：已到复习时间' : '',
                    ].filter(Boolean).join('\n'))}`}
                    className="text-xs text-purple-600"
                  >
                    沉淀成笔记
                  </Link>
                </div>
              </div>
            )
          })}

          {/* 分页 */}
          {total > 20 && (
            <div className="flex justify-center gap-3 pt-2">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-4 py-2 text-sm border rounded-xl disabled:opacity-30"
              >
                上一页
              </button>
              <span className="px-4 py-2 text-sm text-gray-500">
                {page} / {Math.ceil(total / 20)}
              </span>
              <button
                disabled={page >= Math.ceil(total / 20)}
                onClick={() => setPage(p => p + 1)}
                className="px-4 py-2 text-sm border rounded-xl disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
