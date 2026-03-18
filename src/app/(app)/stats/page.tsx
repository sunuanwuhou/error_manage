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
  streak: number
  streakBest: number
  todayDone: boolean
  sectionBreakdown: Array<{ type: string; total: number; stockified: number; masteryAvg: number }>
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

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(data => { setStats(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-2xl animate-pulse" />)}
    </div>
  )
  if (!stats) return null

  const stockifyRate = stats.totalErrors > 0 ? Math.round((stats.stockified / stats.totalErrors) * 100) : 0
  const gap = Math.max(0, stats.targetScore - stats.stockifiedScore - stats.incrementScore)

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <h1 className="text-xl font-bold text-gray-900 mb-5">备考进度</h1>

      {/* O1: 双条线得分预测 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-5">得分预测</h2>
        <div className="space-y-4">
          <ScoreBar score={stats.stockifiedScore} max={stats.targetScore}
            color="text-green-600" label="存量底线分" sublabel="不靠冲刺也稳拿" />
          <ScoreBar score={stats.incrementScore} max={stats.targetScore}
            color="text-orange-500" label="增量空间分" sublabel="mastery 60-80%，考前激活可得" />
          <div className="border-t border-gray-50 pt-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">
                预计得分：<span className="font-bold text-gray-900">{stats.stockifiedScore + stats.incrementScore} 分</span>
              </span>
              <span className="text-gray-400">目标 {stats.targetScore} 分</span>
            </div>
            {gap > 0 && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ 缺口 {gap} 分 = {stats.stockifiedScore < stats.targetScore * 0.6 ? '存量不足，继续深度巩固' : '增量候选太少，把mastery推到60%以上'}
              </p>
            )}
          </div>
        </div>
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
                  <span className="text-gray-400 text-xs">{s.stockified}/{s.total} 稳固 · 均 {s.masteryAvg}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all bg-green-500"
                    style={{ width: `${s.total > 0 ? (s.stockified / s.total) * 100 : 0}%` }} />
                </div>
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
