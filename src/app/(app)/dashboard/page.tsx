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
  activeInsight?: {
    id: string
    paramKey: string
    insightCategory: string
    updatedAt: string
  } | null
  activeInsightSummary?: {
    title: string
    reason: string
    bullets: string[]
  } | null
  strategySnapshot?: {
    playbook?: {
      title: string
      reason: string
      steps: string[]
      nextStep: string
    }
  }
}

interface AIConfig {
  activeModel: string | null
  hasAnthropicKey: boolean
  hasMiniMaxKey: boolean
}

export default function DashboardPage() {
  const { data: session } = useSession()
  const [queue, setQueue] = useState<DailyQueue | null>(null)
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorCount, setErrorCount] = useState<number | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/daily-tasks').then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '今日任务加载失败')
        return data
      }),
      fetch('/api/errors?page=1').then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '错题列表加载失败')
        return data
      }),
      fetch('/api/ai/config').then(async r => {
        const data = await r.json().catch(() => null)
        return r.ok ? data : null
      }).catch(() => null),
    ]).then(([q, e, ai]) => {
      setQueue(q)
      setErrorCount(e.total ?? 0)
      setAiConfig(ai)
      setLoading(false)
    }).catch((error: any) => {
      setLoadError(error?.message ?? '首页加载失败')
      setLoading(false)
    })
  }, [])

  const username     = (session?.user as any)?.name ?? '同学'
  const reviewCount  = queue?.reviewErrors.length ?? 0
  const practiceCount= queue?.practiceQuestions.length ?? 0
  const totalTasks   = reviewCount + practiceCount
  const guardCount   = queue?.guardCount ?? 0
  const isColdStart  = errorCount === 0 && !loading

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 lg:pt-0">
      {/* 头部 */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Dashboard</p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 lg:text-3xl">今日任务</h1>
          <p className="mt-1 text-sm text-gray-400">
            {queue?.daysToExam != null
              ? `距考试 ${queue.daysToExam} 天 · ${session?.user ? username : ''}`
              : `你好，${username}`}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 lg:flex">
          <Link href="/import/screenshot" className="min-h-[44px] rounded-xl border border-gray-200 px-3 py-2 text-center text-sm text-gray-500 lg:px-4 lg:text-base">📷 截图</Link>
          <Link href="/import" className="min-h-[44px] rounded-xl border border-gray-200 px-3 py-2 text-center text-sm text-gray-500 lg:px-4 lg:text-base">📂 导入</Link>
          <Link href="/errors/new" className="min-h-[44px] rounded-xl bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white lg:text-base">+ 录题</Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)] lg:items-start">
        <div className="space-y-4">
          <AlertCards />
          <SkillGapCard compact />

          {/* O6: 冷启动引导 */}
          {isColdStart && (
            <div className="mb-5 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
              <p className="mb-1 font-bold text-blue-900">👋 欢迎！先录入几道错题开始备考</p>
              <p className="mb-4 text-sm text-blue-700">有了错题，系统才能按遗忘曲线帮你复习</p>
              <div className="grid grid-cols-3 gap-2 lg:grid-cols-3">
                <Link href="/errors/new" className="flex flex-col items-center rounded-xl border border-blue-100 bg-white p-3 text-center transition-colors hover:border-blue-300">
                  <span className="mb-1 text-2xl">✏️</span>
                  <span className="text-xs font-medium text-gray-600">手动录题</span>
                </Link>
                <Link href="/errors/batch" className="flex flex-col items-center rounded-xl border border-blue-100 bg-white p-3 text-center transition-colors hover:border-blue-300">
                  <span className="mb-1 text-2xl">📋</span>
                  <span className="text-xs font-medium text-gray-600">批量录题</span>
                </Link>
                <Link href="/import" className="flex flex-col items-center rounded-xl border border-blue-100 bg-white p-3 text-center transition-colors hover:border-blue-300">
                  <span className="mb-1 text-2xl">📂</span>
                  <span className="text-xs font-medium text-gray-600">导入真题</span>
                </Link>
              </div>
            </div>
          )}

          {/* 激活期提示 */}
          {queue?.mode === 'activation' && (
            <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm font-medium text-orange-700">🔥 冲刺模式 · 距考试 {queue.daysToExam} 天</p>
              <p className="mt-1 text-xs text-orange-600">今日只激活记忆，不引入新题。目标 {queue.totalTarget} 道。</p>
            </div>
          )}

          {queue?.activeInsightSummary && (
            <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-900">{queue.activeInsightSummary.title}</p>
              <p className="mt-1 text-xs text-blue-700">{queue.activeInsightSummary.reason}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {queue.activeInsightSummary.bullets.map(bullet => (
                  <span key={bullet} className="rounded-full border border-blue-100 bg-white/80 px-2.5 py-1 text-xs text-blue-700">
                    {bullet}
                  </span>
                ))}
              </div>
            </div>
          )}

          {queue?.strategySnapshot?.playbook && (
            <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">先这么做</p>
                  <p className="mt-1 text-xs text-gray-400">{queue.strategySnapshot.playbook.reason}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">起手顺序</span>
              </div>
              <div className="mt-4 space-y-2">
                {queue.strategySnapshot.playbook.steps.map((step, index) => (
                  <div key={step} className="flex items-start gap-3 rounded-xl bg-gray-50 px-3 py-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                      {index + 1}
                    </span>
                    <span className="text-sm leading-6 text-gray-700">{step}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-blue-700">
                接下来：{queue.strategySnapshot.playbook.nextStep}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-6">
          {aiConfig && (
            <div className={`mb-4 rounded-2xl border p-4 ${
              aiConfig.hasAnthropicKey || aiConfig.hasMiniMaxKey
                ? 'border-violet-100 bg-violet-50'
                : 'border-gray-100 bg-gray-50'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">AI 现在能帮你什么</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {aiConfig.hasAnthropicKey || aiConfig.hasMiniMaxKey
                      ? `当前已启用 ${aiConfig.activeModel ?? 'AI'}，重点用于错因诊断、行动规则和复盘沉淀。`
                      : '当前未配置 AI Key，系统会继续提供练习和笔记能力，但 AI 诊断会降级。'}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs ${
                  aiConfig.hasAnthropicKey || aiConfig.hasMiniMaxKey
                    ? 'border border-violet-100 bg-white text-violet-700'
                    : 'border border-gray-200 bg-white text-gray-500'
                }`}>
                  {aiConfig.hasAnthropicKey || aiConfig.hasMiniMaxKey ? '已启用' : '降级中'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  '错因诊断',
                  '行动规则',
                  '套卷复盘沉淀',
                ].map(item => (
                  <span key={item} className="rounded-full border border-gray-100 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {queue && (
            <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">今天怎么练</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {queue.mode === 'activation'
                      ? `冲刺期优先激活可得分题，距离考试 ${queue.daysToExam ?? '—'} 天`
                      : '建设期优先稳住底线，再把增量题推过门槛'}
                  </p>
                </div>
                <Link href="/stats" className="text-xs text-blue-500 underline">看完整解释</Link>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-400">总目标</p>
                  <p className="text-sm font-bold text-gray-900 tabular-nums">{queue.totalTarget} 道</p>
                </div>
                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-400">错题复盘</p>
                  <p className="text-sm font-bold text-gray-900 tabular-nums">{reviewCount} 道</p>
                </div>
                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-400">真题补位</p>
                  <p className="text-sm font-bold text-gray-900 tabular-nums">{practiceCount} 道</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                守卫复习 {guardCount} 道，系统会优先保底，再补增量。
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Link href="/practice/special" className="flex flex-col items-center rounded-xl bg-gray-50 p-3 text-center hover:bg-gray-100">
              <span className="text-xl">⏱️</span>
              <span className="mt-1 text-xs text-gray-500">专项训练</span>
            </Link>
            <Link href="/anchors" className="flex flex-col items-center rounded-xl bg-gray-50 p-3 text-center hover:bg-gray-100">
              <span className="text-xl">🧠</span>
              <span className="mt-1 text-xs text-gray-500">过口诀</span>
            </Link>
            <Link href="/notes" className="flex flex-col items-center rounded-xl bg-gray-50 p-3 text-center hover:bg-gray-100">
              <span className="text-xl">📝</span>
              <span className="mt-1 text-xs text-gray-500">知识树</span>
            </Link>
          </div>

          {totalTasks > 0 ? (
            <Link href="/practice"
              className="block w-full rounded-2xl bg-blue-600 py-4 text-center text-base font-bold text-white transition-colors hover:bg-blue-700">
              开始今日练习 · {totalTasks} 道
            </Link>
          ) : !isColdStart && (
            <div className="py-8 text-center text-gray-400">
              <p className="mb-2 text-4xl">🎉</p>
              <p className="font-medium">今日任务已完成！</p>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600">
          {loadError}
        </div>
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
                <div className="flex items-center justify-between gap-3">
                  <span>{practiceCount} 道真题待练</span>
                  <div className="flex items-center gap-3">
                    <Link href="/papers" className="text-xs text-blue-500 underline">套卷练习</Link>
                    <span className="text-xs text-gray-300">按考点频率排序</span>
                  </div>
                </div>
              )}
            </div>
          </div>

        </>
      )}
    </div>
  )
}
