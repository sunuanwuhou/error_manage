'use client'
// src/app/(app)/dashboard/page.tsx
// O3: 任务分组（错题复盘 + 真题补位 清晰分区）
// O6: 冷启动引导（无错题时显示引导）

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { AlertCards } from '@/components/dashboard/alert-cards'
import { SkillGapCard } from '@/components/gaps/skill-gap-card'

interface DailyQueue {
  mode: 'building' | 'activation'
  reviewErrors: Array<{ userErrorId: string; questionId: string; masteryPercent: number; state: string; errorROI: number; isOverdue: boolean; isHot: boolean; questionType: string }>
  guardCount?: number
  practiceQuestions: string[]
  totalTarget: number
  daysToExam: number | null
}

export default function DashboardPage() {
  const { data: session } = useSession()
  const [queue, setQueue] = useState<DailyQueue | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorCount, setErrorCount] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/daily-tasks').then(r => r.json()),
      fetch('/api/errors?page=1').then(r => r.json()),
    ]).then(([q, e]) => {
      setQueue(q)
      setErrorCount(e.total ?? 0)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const username     = (session?.user as any)?.name ?? '同学'
  const reviewCount  = queue?.reviewErrors.length ?? 0
  const practiceCount= queue?.practiceQuestions.length ?? 0
  const totalTasks   = reviewCount + practiceCount
  const isColdStart  = errorCount === 0 && !loading

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">今日任务</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {queue?.daysToExam != null
              ? `距考试 ${queue.daysToExam} 天 · ${session?.user ? username : ''}`
              : `你好，${username}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/import/screenshot" className="border border-gray-200 text-gray-500 text-sm px-3 py-2 rounded-xl min-h-[44px] flex items-center">📷</Link>
          <Link href="/import"    className="border border-gray-200 text-gray-500 text-sm px-3 py-2 rounded-xl min-h-[44px] flex items-center">📂</Link>
          <Link href="/errors/new" className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl font-medium min-h-[44px] flex items-center">+ 录题</Link>
        </div>
      </div>

      <AlertCards />
      <SkillGapCard compact />

      {/* O6: 冷启动引导 */}
      {isColdStart && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5 mb-5">
          <p className="font-bold text-blue-900 mb-1">👋 欢迎！先录入几道错题开始备考</p>
          <p className="text-sm text-blue-700 mb-4">有了错题，系统才能按遗忘曲线帮你复习</p>
          <div className="grid grid-cols-3 gap-2">
            <Link href="/errors/new" className="flex flex-col items-center p-3 bg-white rounded-xl border border-blue-100 text-center hover:border-blue-300 transition-colors">
              <span className="text-2xl mb-1">✏️</span>
              <span className="text-xs text-gray-600 font-medium">手动录题</span>
            </Link>
            <Link href="/errors/batch" className="flex flex-col items-center p-3 bg-white rounded-xl border border-blue-100 text-center hover:border-blue-300 transition-colors">
              <span className="text-2xl mb-1">📋</span>
              <span className="text-xs text-gray-600 font-medium">批量录题</span>
            </Link>
            <Link href="/import" className="flex flex-col items-center p-3 bg-white rounded-xl border border-blue-100 text-center hover:border-blue-300 transition-colors">
              <span className="text-2xl mb-1">📂</span>
              <span className="text-xs text-gray-600 font-medium">导入真题</span>
            </Link>
          </div>
        </div>
      )}

      {/* 激活期提示 */}
      {queue?.mode === 'activation' && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-4">
          <p className="text-orange-700 font-medium text-sm">🔥 冲刺模式 · 距考试 {queue.daysToExam} 天</p>
          <p className="text-orange-600 text-xs mt-1">今日只激活记忆，不引入新题。目标 {queue.totalTarget} 道。</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : (
        <>
          {/* O3: 错题复盘区块（独立分组）*/}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <span>📕</span>
                <span className="font-semibold text-gray-900 text-sm">错题复盘</span>
                {(queue?.guardCount ?? 0) > 0 && (
                  <span className="text-xs text-gray-400">（含 {queue!.guardCount} 道守卫复习）</span>
                )}
              </div>
              <span className="text-sm font-bold text-blue-600">{reviewCount} 道</span>
            </div>
            {reviewCount === 0 ? (
              <div className="px-4 py-5 text-center text-gray-400 text-sm">今日没有到期错题 🎉</div>
            ) : (
              <>
                <div className="divide-y divide-gray-50">
                  {queue!.reviewErrors.slice(0, 3).map((item, i) => (
                    <div key={item.userErrorId} className="px-4 py-3 flex items-center gap-3">
                      <span className="text-base">{item.isHot ? '🔥' : item.state === 'increment_candidate' ? '🔥' : item.state === 'stockified' ? '✅' : '🔨'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs text-gray-500">{item.questionType}</span>
                          {item.isOverdue && <span className="text-xs text-red-500">逾期</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${item.masteryPercent}%`,
                              backgroundColor: item.masteryPercent >= 80 ? '#16a34a' : item.masteryPercent >= 60 ? '#ea580c' : '#2563eb'
                            }} />
                          </div>
                          <span className="text-xs text-gray-400 w-8 text-right tabular-nums">{item.masteryPercent}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {reviewCount > 3 && (
                    <div className="px-4 py-2 text-center text-xs text-gray-400">还有 {reviewCount - 3} 道...</div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* O3: 真题补位区块（独立分组）*/}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-5">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <span>📄</span>
                <span className="font-semibold text-gray-900 text-sm">真题练习</span>
              </div>
              <span className="text-sm font-bold text-blue-600">{practiceCount} 道</span>
            </div>
            <div className="px-4 py-3 text-sm text-gray-500">
              {practiceCount === 0 ? (
                <div className="flex items-center justify-between">
                  <span>暂无真题，先去导入</span>
                  <a href="/import" className="text-xs text-blue-500 underline">导入真题</a>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span>{practiceCount} 道真题待练</span>
                  <span className="text-xs text-gray-300">按考点频率排序</span>
                </div>
              )}
            </div>
          </div>

          {/* 快捷入口 */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            <Link href="/practice/special" className="flex flex-col items-center p-3 bg-gray-50 rounded-xl text-center hover:bg-gray-100">
              <span className="text-xl">⏱️</span>
              <span className="text-xs text-gray-500 mt-1">专项训练</span>
            </Link>
            <Link href="/anchors" className="flex flex-col items-center p-3 bg-gray-50 rounded-xl text-center hover:bg-gray-100">
              <span className="text-xl">🧠</span>
              <span className="text-xs text-gray-500 mt-1">过口诀</span>
            </Link>
            <Link href="/notes" className="flex flex-col items-center p-3 bg-gray-50 rounded-xl text-center hover:bg-gray-100">
              <span className="text-xl">📝</span>
              <span className="text-xs text-gray-500 mt-1">笔记规律</span>
            </Link>
          </div>

          {/* 开始按钮 */}
          {totalTasks > 0 ? (
            <Link href="/practice"
              className="block w-full py-4 bg-blue-600 text-white text-center font-bold rounded-2xl text-base hover:bg-blue-700 transition-colors">
              开始今日练习 · {totalTasks} 道
            </Link>
          ) : !isColdStart && (
            <div className="text-center py-8 text-gray-400">
              <p className="text-4xl mb-2">🎉</p>
              <p className="font-medium">今日任务已完成！</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
