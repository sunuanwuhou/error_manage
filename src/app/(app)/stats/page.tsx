'use client'
// src/app/(app)/stats/page.tsx — 进度分析页（完整版）
// O1: 存量+增量双条线视觉（██░░░样式）
// A6: 连续打卡成就徽章

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExamStrategyCard } from '@/components/stats/exam-strategy-card'
import { SkillGapCard } from '@/components/gaps/skill-gap-card'
import { ErrorPatternsCard } from '@/components/stats/error-patterns-card'

interface Stats {
  totalErrors: number
  stockified: number
  incrementCandidates: number
  building: number
  skipped: number
  predictedScore: number
  targetScore: number
  stockifiedScore: number
  incrementScore: number
  conservativeScore: number
  optimisticScore: number
  todayPracticeCount: number
  todayCorrect: number
  todayMasteryGain: number
  todayConservativeGain: number
  todayOptimisticGain: number
  todayEstimatedGain: number
  todayStockifiedCount: number
  gapSources: Array<{
    type: string
    remainingGap: number
    conservativeScore: number
    optimisticScore: number
    scoreWeight: number
    hint: string
  }>
  nextAction: {
    title: string
    reason: string
  }
  streak: number
  streakBest: number
  todayDone: boolean
  sectionBreakdown: Array<{
    type: string
    total: number
    stockified: number
    masteryAvg: number
    incrementCandidates: number
    scoreWeight: number
    conservativeScore: number
    optimisticScore: number
    remainingGap: number
  }>
  strategySnapshot?: {
    activeInsight: {
      id: string
      paramKey: string
      insightCategory: string
      updatedAt: string
    } | null
    activeInsightSummary: {
      title: string
      reason: string
      bullets: string[]
    } | null
    playbook: {
      title: string
      reason: string
      steps: string[]
      nextStep: string
    }
    mode: 'building' | 'activation'
    totalTarget: number
    errorLimit: number
    guardLimit: number
    activationThresholdDays: number
    daysToExam: number | null
  }
}

// O1: 视觉进度条（文档设计的 ██░░░ 样式）
function ScoreBar({ score, max, color, label, sublabel }: {
  score: number; max: number; color: string; label: string; sublabel: string
}) {
  const pct = max > 0 ? Math.min((score / max) * 100, 100) : 0
  const filled = Math.round(pct / 5)  // 20格，每格5%
  const empty  = 20 - filled

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className={`font-bold tabular-nums ${color}`}>{score} 分</span>
      </div>
      <div className="font-mono text-sm leading-none mb-0.5" style={{ color: color.replace('text-', '#') }}>
        <span style={{ color: color === 'text-green-600' ? '#16a34a' : '#ea580c' }}>
          {'█'.repeat(filled)}
        </span>
        <span className="text-gray-200">{'░'.repeat(empty)}</span>
      </div>
      <p className="text-xs text-gray-400">{sublabel}</p>
    </div>
  )
}

// A6: 成就徽章
function StreakBadges({ streak, best }: { streak: number; best: number }) {
  const badges = [
    { days: 7,  icon: '🥉', label: '坚持7天',  unlocked: best >= 7  },
    { days: 30, icon: '🥈', label: '坚持30天', unlocked: best >= 30 },
    { days: 100,icon: '🥇', label: '百日坚持', unlocked: best >= 100},
  ]
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl">🔥</span>
        <div>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{streak} 天</p>
          <p className="text-xs text-gray-400">当前连续 · 历史最高 {best} 天</p>
        </div>
      </div>
      <div className="flex gap-3">
        {badges.map(b => (
          <div key={b.days} className={`flex-1 text-center p-2 rounded-xl border transition-colors
            ${b.unlocked ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-100 opacity-40'}`}>
            <div className="text-2xl">{b.icon}</div>
            <p className="text-xs text-gray-500 mt-0.5">{b.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function StatsPage() {
  const [stats, setStats]   = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/stats')
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '进度加载失败')
        setStats(data)
        setLoading(false)
      })
      .catch((e: any) => {
        setError(e?.message ?? '进度加载失败')
        setLoading(false)
      })
  }, [])

  if (loading) return (
    <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-2xl animate-pulse" />)}
    </div>
  )
  if (!stats) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error || '进度数据暂时不可用'}
        </div>
      </div>
    )
  }

  const stockifyRate = stats.totalErrors > 0 ? Math.round((stats.stockified / stats.totalErrors) * 100) : 0
  const gap = Math.max(0, stats.targetScore - stats.optimisticScore)
  const todayAccuracy = stats.todayPracticeCount > 0
    ? Math.round((stats.todayCorrect / stats.todayPracticeCount) * 100)
    : 0
  const strategy = stats.strategySnapshot
  const strategySummary = strategy?.activeInsightSummary ?? null
  const hasAppliedStrategy = Boolean(strategySummary)
  const trainingModeLabel = strategy?.mode === 'activation' ? '冲刺模式' : '建设模式'
  const strategyTotalTargetLabel = strategy ? `${strategy.totalTarget} 道` : '—'
  const strategyDaysToExamLabel = strategy?.daysToExam ?? '—'

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="mb-5 lg:flex lg:items-end lg:justify-between">
        <h1 className="text-xl font-bold text-gray-900">备考进度</h1>
        <p className="mt-1 text-xs text-gray-400">大屏更适合看预测、差距和训练节奏。</p>
      </div>

      {strategySummary && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 mb-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-xs font-medium text-blue-500">今天怎么练</p>
              <p className="text-base font-bold text-blue-900 mt-1">{strategySummary.title}</p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full ${hasAppliedStrategy ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              {hasAppliedStrategy ? '策略已生效' : '暂无策略'}
            </span>
          </div>
          <p className="text-sm text-blue-700">{strategySummary.reason}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {strategySummary.bullets.map(bullet => (
              <span key={bullet} className="rounded-full bg-white/90 px-2.5 py-1 text-xs text-blue-700 border border-blue-100">
                {bullet}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <div className="rounded-xl bg-white/80 px-2 py-2">
              <p className="text-sm font-bold text-blue-900">{trainingModeLabel}</p>
              <p className="text-[11px] text-blue-400 mt-0.5">当前训练模式</p>
            </div>
            <div className="rounded-xl bg-white/80 px-2 py-2">
              <p className="text-sm font-bold text-blue-900">{strategyTotalTargetLabel}</p>
              <p className="text-[11px] text-blue-400 mt-0.5">今日目标</p>
            </div>
            <div className="rounded-xl bg-white/80 px-2 py-2">
              <p className="text-sm font-bold text-blue-900">{strategyDaysToExamLabel}</p>
              <p className="text-[11px] text-blue-400 mt-0.5">距考试天数</p>
            </div>
          </div>
        </div>
      )}

      {strategy?.playbook && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-gray-500">起手顺序</p>
              <p className="text-base font-bold text-gray-900 mt-1">{strategy.playbook.title}</p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">今天先这样做</span>
          </div>
          <p className="text-sm text-gray-600 mt-2">{strategy.playbook.reason}</p>
          <div className="mt-4 space-y-2">
            {strategy.playbook.steps.map((step, index) => (
              <div key={step} className="flex items-start gap-3 rounded-xl bg-gray-50 px-3 py-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                  {index + 1}
                </span>
                <span className="text-sm text-gray-700 leading-6">{step}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-blue-700 mt-3">接下来：{strategy.playbook.nextStep}</p>
        </div>
      )}

      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-3xl p-5 mb-4 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-300 mb-2">考试预测</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-slate-300">保守估计</p>
            <p className="text-3xl font-bold tabular-nums">{stats.conservativeScore}</p>
            <p className="text-xs text-slate-400 mt-1">只算已稳固存量</p>
          </div>
          <div>
            <p className="text-sm text-slate-300">乐观估计</p>
            <p className="text-3xl font-bold tabular-nums">{stats.optimisticScore}</p>
            <p className="text-xs text-slate-400 mt-1">含当前可激活增量</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/10 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-300">目标分</p>
            <p className="text-lg font-semibold tabular-nums">{stats.targetScore} 分</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-300">当前差距</p>
            <p className={`text-lg font-semibold tabular-nums ${gap > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
              {gap > 0 ? `还差 ${gap} 分` : '已达到当前目标带'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">今天练习的价值</h2>
            <p className="text-xs text-gray-400 mt-1">不是做了多少题，而是往目标分推进了多少</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-blue-600 tabular-nums">+{stats.todayEstimatedGain}</p>
            <p className="text-xs text-gray-400">预计今日推进</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="rounded-2xl bg-gray-50 p-3">
            <p className="text-xs text-gray-400">稳固新增</p>
            <p className="text-lg font-bold text-green-600 tabular-nums">+{stats.todayConservativeGain} 分</p>
            <p className="text-xs text-gray-500 mt-1">{stats.todayStockifiedCount} 道题进入稳固区</p>
          </div>
          <div className="rounded-2xl bg-gray-50 p-3">
            <p className="text-xs text-gray-400">激活推进</p>
            <p className="text-lg font-bold text-orange-500 tabular-nums">+{stats.todayOptimisticGain} 分</p>
            <p className="text-xs text-gray-500 mt-1">今日掌握度累计 +{stats.todayMasteryGain}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-500">今日练习</span>
          <span className="font-medium text-gray-900">
            {stats.todayPracticeCount} 道 · 正确率 {todayAccuracy}%
          </span>
        </div>
      </div>

      {/* O1: 双条线得分预测 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-5">得分预测</h2>
        <div className="space-y-4">
          <ScoreBar score={stats.conservativeScore} max={stats.targetScore}
            color="text-green-600" label="存量底线分" sublabel="不靠冲刺也稳拿" />
          <ScoreBar score={stats.incrementScore} max={stats.targetScore}
            color="text-orange-500" label="增量空间分" sublabel="mastery 60-80%，考前激活可得" />
          <div className="border-t border-gray-50 pt-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">
                乐观得分：<span className="font-bold text-gray-900">{stats.optimisticScore} 分</span>
              </span>
              <span className="text-gray-400">目标 {stats.targetScore} 分</span>
            </div>
            {gap > 0 && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ 缺口 {gap} 分，优先补足最拖后腿的题型，而不是平均用力。
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">差距来自哪里</h2>
        {stats.gapSources.length === 0 ? (
          <p className="text-sm text-gray-500">当前主要题型已经形成基础盘，接下来重点保持节奏和整卷训练。</p>
        ) : (
          <div className="space-y-3">
            {stats.gapSources.map(source => (
              <div key={source.type} className="rounded-2xl bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{source.type}</p>
                    <p className="text-xs text-gray-500 mt-1">{source.hint}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-amber-600 tabular-nums">{source.remainingGap}</p>
                    <p className="text-xs text-gray-400">剩余缺口</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                  <span>稳固 {source.conservativeScore} 分</span>
                  <span>·</span>
                  <span>可激活 {source.optimisticScore} 分</span>
                  <span>·</span>
                  <span>题型权重 {source.scoreWeight} 分</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 mb-4">
        <p className="text-xs font-medium text-blue-500 mb-2">下一步建议</p>
        <p className="text-lg font-bold text-blue-900">{stats.nextAction.title}</p>
        <p className="text-sm text-blue-700 mt-1">{stats.nextAction.reason}</p>
        {strategySummary && (
          <p className="text-xs text-blue-600 mt-3">
            系统当前按已生效策略排题，优先看最有缺口的题型，而不是平均用力。
          </p>
        )}
      </div>

      {/* 错题状态 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">错题状态</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '总错题',    value: stats.totalErrors,         color: 'text-gray-700' },
            { label: '✅ 已稳固', value: stats.stockified,          color: 'text-green-600' },
            { label: '🔥 冲刺目标',value: stats.incrementCandidates, color: 'text-orange-500' },
            { label: '🔨 攻坚中', value: stats.building,            color: 'text-blue-600' },
          ].map(item => (
            <div key={item.label} className="bg-gray-50 rounded-xl p-3 text-center">
              <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
              <p className="text-xs text-gray-400 mt-1">{item.label}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>存量化进度</span><span>{stockifyRate}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${stockifyRate}%` }} />
          </div>
        </div>
      </div>

      {/* 题型进度 */}
      {stats.sectionBreakdown.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">题型进度</h2>
          <div className="space-y-3">
            {stats.sectionBreakdown.map(s => (
              <div key={s.type}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700">{s.type}</span>
                  <span className="text-gray-400 text-xs">
                    稳固 {s.conservativeScore} / 可激活 {s.optimisticScore} / 缺口 {s.remainingGap}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all bg-green-500"
                    style={{ width: `${s.total > 0 ? (s.stockified / s.total) * 100 : 0}%` }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {s.stockified}/{s.total} 稳固 · 冲刺目标 {s.incrementCandidates} 个 · 均 {s.masteryAvg}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <SkillGapCard />
      <ErrorPatternsCard />
      <ExamStrategyCard />

      {/* 记忆锚点 */}
      <Link href="/anchors" className="block bg-indigo-50 border border-indigo-200 rounded-2xl p-4 mb-4 text-center">
        <p className="font-semibold text-indigo-700">🧠 快速过口诀</p>
        <p className="text-xs text-indigo-500 mt-0.5">考前激活已稳固考点记忆</p>
      </Link>

      {/* 模拟考入口 */}
      <Link href="/mock-tests" className="block bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between">
          <div><p className="font-semibold text-gray-900 text-sm">📝 模拟考成绩</p>
          <p className="text-xs text-gray-400 mt-0.5">录入真题成绩，追踪进步趋势</p></div>
          <span className="text-gray-300 text-xl">›</span>
        </div>
      </Link>

      {/* A6: 连续打卡成就徽章 */}
      <StreakBadges streak={stats.streak} best={stats.streakBest} />
    </div>
  )
}
