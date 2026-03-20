'use client'
// src/app/(app)/practice/summary/page.tsx

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Summary {
  total: number
  correct: number
  wrong: number
  accuracy: number
  newStockified: number
  slowCorrect: number
  byType: Array<{ type: string; accuracy: number; total: number; correct: number }>
  stockifiedItems: Array<{ type: string; subtype?: string; masteryPercent: number }>
  paperStats?: {
    totalExpected: number
    answered: number
    completionRate: number
    durationSeconds: number
    markedCount: number
    unansweredCount: number
    markedQuestions: number[]
    unansweredQuestions: number[]
    completed?: boolean
    statusLabel?: string
    statusDetail?: string
    reviewHint?: string
    focusTypes?: Array<{
      type: string
      accuracy: number
      total: number
      correct: number
      gapLabel: string
    }>
    byModule?: Array<{
      module: string
      type: string
      subtype?: string
      accuracy: number
      total: number
      correct: number
    }>
    focusModules?: Array<{
      module: string
      type: string
      subtype?: string
      accuracy: number
      total: number
      correct: number
      gapLabel: string
    }>
    recommendedNextAction?: string
    firstUnansweredQuestion?: number | null
    firstMarkedQuestion?: number | null
    primaryFocusModule?: string | null
  }
}

export default function SummaryPage() {
  const router      = useRouter()
  const params      = useSearchParams()
  const since       = params.get('since')
  const paper       = params.get('paper')
  const paperTitle  = params.get('paperTitle')
  const paperYear   = params.get('paperYear')
  const sessionId   = params.get('sessionId')
  const totalExpected = params.get('totalExpected')
  const durationSeconds = params.get('durationSeconds')
  const markedQuestions = params.get('markedQuestions')
  const unansweredQuestions = params.get('unansweredQuestions')
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!since) { router.push('/dashboard'); return }
    const query = new URLSearchParams({ since })
    if (paper) query.set('paper', paper)
    if (sessionId) query.set('sessionId', sessionId)
    if (totalExpected) query.set('totalExpected', totalExpected)
    if (durationSeconds) query.set('durationSeconds', durationSeconds)
    if (markedQuestions) query.set('markedQuestions', markedQuestions)
    if (unansweredQuestions) query.set('unansweredQuestions', unansweredQuestions)
    setError('')
    fetch(`/api/review/session-summary?${query.toString()}`)
      .then(async r => {
        const result = await r.json()
        if (!r.ok) throw new Error(result.error ?? '练习总结加载失败')
        setData(result)
      })
      .catch((e: any) => {
        setData(null)
        setError(e?.message ?? '练习总结加载失败')
      })
  }, [since, paper, sessionId, totalExpected, durationSeconds, markedQuestions, unansweredQuestions, router])

  if (!data && !error) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-gray-400">汇总中...</div>
    </div>
  )

  if (error) return (
    <div className="max-w-lg mx-auto px-4 pt-16">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <p className="text-base font-semibold text-red-700">练习总结加载失败</p>
        <p className="mt-2 text-sm text-red-600">{error}</p>
      </div>
      <div className="mt-4 space-y-3">
        <Link
          href={paper ? '/papers' : '/dashboard'}
          className="block w-full py-4 bg-blue-600 text-white font-bold rounded-2xl text-center text-base"
        >
          {paper ? '返回套卷列表' : '返回首页'}
        </Link>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="block w-full py-3 border border-gray-200 text-gray-600 font-medium rounded-2xl text-center text-sm"
        >
          重新加载
        </button>
      </div>
    </div>
  )

  if (!data) return null

  const summary = data
  const paperStats = summary.paperStats
  const focusTypes = paperStats?.focusTypes ?? []
  const focusModules = paperStats?.focusModules ?? []
  const recommendedNextAction = paperStats?.recommendedNextAction ?? ''
  const firstUnansweredQuestion = paperStats?.firstUnansweredQuestion ?? null
  const firstMarkedQuestion = paperStats?.firstMarkedQuestion ?? null
  const primaryFocusModule = paperStats?.primaryFocusModule ?? null
  const quickActions = paper ? [
    firstUnansweredQuestion != null
      ? {
          href: `/practice?paper=${encodeURIComponent(paper)}&startAtQuestion=${firstUnansweredQuestion}`,
          title: `回到第 ${firstUnansweredQuestion} 题`,
          description: '先补未作答，再回来收尾',
          tone: 'amber',
        }
      : null,
    firstMarkedQuestion != null
      ? {
          href: `/practice?paper=${encodeURIComponent(paper)}&startAtQuestion=${firstMarkedQuestion}`,
          title: `重看存疑题 ${firstMarkedQuestion}`,
          description: '优先确认犹豫题',
          tone: 'rose',
        }
      : null,
    primaryFocusModule
      ? {
          href: `/practice?paper=${encodeURIComponent(paper)}&focusModule=${encodeURIComponent(primaryFocusModule)}`,
          title: `重做弱模块 ${primaryFocusModule}`,
          description: '回补当前最弱模块',
          tone: 'indigo',
        }
      : null,
  ].filter(Boolean) as Array<{
    href: string
    title: string
    description: string
    tone: 'amber' | 'rose' | 'indigo'
  }> : []
  const performanceTone =
    summary.accuracy >= 85 ? '这套卷的正确率已经比较稳，可以转向查漏和提速。' :
    summary.accuracy >= 65 ? '正确率进入可提升区间，重点看错题最多的题型和慢正确。' :
    '这套卷还处在打基础阶段，先稳住正确率，再追求速度。'
  const topWeakType = summary.byType.length > 0
    ? [...summary.byType].sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)[0]
    : null
  const paperNoteDraftLink = paper
    ? `/notes?draft=1&draftKind=notes&draftType=${encodeURIComponent(primaryFocusModule?.split(' · ')[0] || paperStats?.focusTypes?.[0]?.type || '判断推理')}&draftSubtype=${encodeURIComponent('套卷总结')}&draftTitle=${encodeURIComponent(`${paperYear ? `${paperYear} · ` : ''}${paperTitle || '套卷'}复盘`) }&draftContent=${encodeURIComponent([
        `${paperYear ? `${paperYear} · ` : ''}${paperTitle || '套卷'}复盘`,
        `正确率：${summary.accuracy}%（${summary.correct}/${summary.total}）`,
        paperStats?.completionRate != null ? `完成率：${paperStats.completionRate}%` : '',
        recommendedNextAction ? `下一步：${recommendedNextAction}` : '',
        primaryFocusModule ? `优先回补模块：${primaryFocusModule}` : '',
        paperStats?.reviewHint ? `复盘提醒：${paperStats.reviewHint}` : '',
      ].filter(Boolean).join('\n'))}`
    : null
  const dailyNoteDraftLink = !paper
    ? `/notes?draft=1&draftKind=notes&draftType=${encodeURIComponent(topWeakType?.type || '判断推理')}&draftSubtype=${encodeURIComponent('错题复盘')}&draftTitle=${encodeURIComponent(`今日练习复盘 ${summary.accuracy}%`)}&draftContent=${encodeURIComponent([
        `今日练习复盘`,
        `正确率：${summary.accuracy}%（${summary.correct}/${summary.total}）`,
        summary.wrong > 0 ? `答错：${summary.wrong} 题` : '',
        summary.slowCorrect > 0 ? `慢正确：${summary.slowCorrect} 题` : '',
        topWeakType ? `当前最弱题型：${topWeakType.type}（${topWeakType.accuracy}%）` : '',
        summary.newStockified > 0 ? `今日存量化：${summary.newStockified} 题` : '',
        `复盘结论：${performanceTone}`,
      ].filter(Boolean).join('\n'))}`
    : null

  return (
    <div className="max-w-lg mx-auto px-4 pt-8 pb-24">
      {/* 主标题 */}
      <div className="text-center mb-8 lg:mb-10">
        <div className="text-6xl mb-3">
          {summary.newStockified > 0 ? '🏆' : summary.accuracy >= 80 ? '🎉' : '💪'}
        </div>
        <h2 className="text-2xl font-bold text-gray-900">{paper ? '套卷练习完成' : '今日练习完成'}</h2>
        <p className="text-gray-500 mt-1">
          {paperTitle ? `${paperYear ? `${paperYear} · ` : ''}${paperTitle} · 共 ${paperStats?.totalExpected ?? summary.total} 道题` : `共 ${summary.total} 道题`}
        </p>
      </div>

      {paper && paperStats && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4 lg:p-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">整卷复盘</h3>
              <p className="text-xs text-gray-400 mt-1">{paperStats.statusLabel ?? '整卷状态'}</p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full ${
              paperStats.completed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {paperStats.completed ? '已完成' : '未完成'}
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-4">{paperStats.statusDetail}</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-lg font-bold text-blue-700">{paperStats.completionRate}%</p>
              <p className="text-xs text-gray-400 mt-1">完成率</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-lg font-bold text-gray-900">{paperStats.answered}/{paperStats.totalExpected}</p>
              <p className="text-xs text-gray-400 mt-1">已作答</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-lg font-bold text-red-600">{paperStats.unansweredCount}</p>
              <p className="text-xs text-gray-400 mt-1">未作答</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-lg font-bold text-blue-700">{Math.max(0, Math.round(paperStats.durationSeconds / 60))} 分</p>
              <p className="text-xs text-gray-400 mt-1">整卷用时</p>
            </div>
          </div>

          {paperStats.reviewHint && (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-medium text-blue-500 mb-1">本卷复盘建议</p>
              <p className="text-sm text-blue-900">{paperStats.reviewHint}</p>
            </div>
          )}

          {recommendedNextAction && (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-medium text-emerald-600 mb-1">下一步怎么做</p>
              <p className="text-sm text-emerald-900">{recommendedNextAction}</p>
            </div>
          )}

          {quickActions.length > 0 && (
            <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium text-gray-500 mb-3">直接回跳</p>
              <div className="grid gap-3 lg:grid-cols-3">
                {quickActions.map(action => (
                  <Link
                    key={action.title}
                    href={action.href}
                    className={`rounded-2xl border bg-white px-4 py-3 text-left transition-colors ${
                      action.tone === 'amber'
                        ? 'border-amber-200 hover:border-amber-300'
                        : action.tone === 'rose'
                          ? 'border-rose-200 hover:border-rose-300'
                          : 'border-indigo-200 hover:border-indigo-300'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${
                      action.tone === 'amber'
                        ? 'text-amber-700'
                        : action.tone === 'rose'
                          ? 'text-rose-700'
                          : 'text-indigo-700'
                    }`}>
                      {action.title}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{action.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {focusModules.length > 0 && (
            <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
              <p className="text-xs font-medium text-indigo-500 mb-2">优先回看的模块</p>
              <div className="grid gap-2 lg:grid-cols-2">
                {focusModules.map(item => (
                  <div key={item.module} className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-indigo-950 truncate">{item.module}</p>
                      <p className="text-[11px] text-indigo-400 mt-0.5">{item.gapLabel}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-indigo-900">{item.accuracy}%</p>
                      <p className="text-[11px] text-indigo-400">{item.correct}/{item.total}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(paperStats.unansweredQuestions.length > 0 || paperStats.markedQuestions.length > 0) && (
            <div className="space-y-3 mt-4">
              {paperStats.unansweredQuestions.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-amber-600 mb-2">未作答题号</p>
                  <div className="flex flex-wrap gap-2">
                    {paperStats.unansweredQuestions.map(questionNo => (
                      <span key={`unanswered-${questionNo}`} className="min-w-[36px] px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs text-center">
                        {questionNo}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {paperStats.markedQuestions.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-red-600 mb-2">存疑题号</p>
                  <div className="flex flex-wrap gap-2">
                    {paperStats.markedQuestions.map(questionNo => (
                      <span key={`marked-${questionNo}`} className="min-w-[36px] px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs text-center">
                        {questionNo}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 新增存量化（最重要的正反馈）*/}
      {summary.newStockified > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-4 text-center">
          <p className="text-4xl font-bold text-green-600">+{summary.newStockified}</p>
          <p className="text-green-700 font-semibold mt-1">道题今日存量化 ✅</p>
          <p className="text-xs text-green-600 mt-1">这些考点已稳固，不靠冲刺也能拿分</p>
          {summary.stockifiedItems.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {summary.stockifiedItems.map((item, i) => (
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
        <div className="grid grid-cols-4 divide-x divide-gray-100">
          {[
            { label: '正确率', value: `${summary.accuracy}%`,
              color: summary.accuracy >= 80 ? 'text-green-600' : summary.accuracy >= 60 ? 'text-blue-600' : 'text-red-500' },
            { label: '答对',   value: `${summary.correct}/${summary.total}`, color: 'text-gray-900' },
            { label: '答错',   value: summary.wrong, color: 'text-red-500' },
            { label: '慢正确', value: summary.slowCorrect,
              color: summary.slowCorrect > 2 ? 'text-amber-500' : 'text-gray-400' },
          ].map(item => (
            <div key={item.label} className="text-center px-3">
              <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
        {summary.slowCorrect > 2 && (
          <p className="text-xs text-amber-600 text-center mt-3 bg-amber-50 rounded-xl py-2">
            ⚠️ {summary.slowCorrect} 道题超速度警戒线，实考会丢分，建议练速度
          </p>
        )}
        <p className="text-xs text-gray-500 mt-3">{performanceTone}</p>
      </div>

      {/* 题型正确率 */}
      {summary.byType.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">各题型表现</h3>
              <p className="text-xs text-gray-400 mt-1">先看弱项，再决定是重做整卷还是单独回补</p>
            </div>
            <span className="text-xs text-gray-400">{summary.byType.length} 个题型</span>
          </div>
          <div className="space-y-3">
            {summary.byType.map(t => (
              <div key={t.type} className="rounded-2xl bg-gray-50 p-3">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-gray-800 font-medium">{t.type}</span>
                  <span className={`font-medium tabular-nums ${
                    t.accuracy >= 80 ? 'text-green-600' : t.accuracy >= 60 ? 'text-blue-600' : 'text-red-500'
                  }`}>
                    {t.accuracy}% · {t.correct}/{t.total}
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

      {paper && paperStats?.byModule && paperStats.byModule.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">模块表现</h3>
              <p className="text-xs text-gray-400 mt-1">比大题型更细，适合直接决定下一轮回补顺序</p>
            </div>
            <span className="text-xs text-gray-400">{paperStats.byModule.length} 个模块</span>
          </div>
          <div className="space-y-3">
            {paperStats.byModule.map(item => (
              <div key={item.module} className="rounded-2xl bg-gray-50 p-3">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-gray-800 font-medium">{item.module}</span>
                  <span className={`font-medium tabular-nums ${
                    item.accuracy >= 80 ? 'text-green-600' : item.accuracy >= 60 ? 'text-blue-600' : 'text-red-500'
                  }`}>
                    {item.accuracy}%
                  </span>
                </div>
                <div className="h-2 bg-white rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      item.accuracy >= 80 ? 'bg-green-500' : item.accuracy >= 60 ? 'bg-blue-500' : 'bg-red-400'
                    }`}
                    style={{ width: `${item.accuracy}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  做对 {item.correct} / {item.total} 题
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {paper && focusTypes.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">优先回看</h3>
          <div className="space-y-3">
            {focusTypes.map(item => (
              <div key={item.type} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{item.type}</p>
                    <p className="text-xs text-gray-500 mt-1">{item.gapLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-amber-600 tabular-nums">{item.accuracy}%</p>
                    <p className="text-xs text-gray-400">正确率</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部按钮 */}
      <div className="space-y-3">
        <Link href={paper ? '/papers' : '/dashboard'}
          className="block w-full py-4 bg-blue-600 text-white font-bold rounded-2xl text-center text-base">
          {paper ? '返回套卷列表' : '返回首页'}
        </Link>
      {!paper && dailyNoteDraftLink && (
        <Link
          href={dailyNoteDraftLink}
          className="block w-full py-3 border border-purple-200 text-purple-700 font-medium rounded-2xl text-center text-sm"
        >
          沉淀今日复盘到笔记
        </Link>
      )}
      {paper && (
        <div className="grid grid-cols-2 gap-3">
          <Link href={`/practice?paper=${encodeURIComponent(paper)}`}
            className="block w-full py-3 border border-blue-200 text-blue-600 font-medium rounded-2xl text-center text-sm">
            再做一遍这套卷
          </Link>
          <Link
            href={firstUnansweredQuestion != null
              ? `/practice?paper=${encodeURIComponent(paper)}&startAtQuestion=${firstUnansweredQuestion}`
              : `/practice?paper=${encodeURIComponent(paper)}`
            }
            className="block w-full py-3 border border-emerald-200 text-emerald-700 font-medium rounded-2xl text-center text-sm"
          >
            {firstUnansweredQuestion != null ? `从第 ${firstUnansweredQuestion} 题继续` : '继续这套卷'}
          </Link>
          <Link href="/stats"
            className="block w-full py-3 border border-gray-200 text-gray-600 font-medium rounded-2xl text-center text-sm">
            查看总进度
          </Link>
          {paperNoteDraftLink && (
            <Link
              href={paperNoteDraftLink}
              className="block w-full py-3 border border-purple-200 text-purple-700 font-medium rounded-2xl text-center text-sm"
            >
              沉淀本卷复盘到笔记
            </Link>
          )}
          {firstMarkedQuestion != null && (
            <Link
              href={`/practice?paper=${encodeURIComponent(paper)}&startAtQuestion=${firstMarkedQuestion}`}
              className="block w-full py-3 border border-amber-200 text-amber-700 font-medium rounded-2xl text-center text-sm"
            >
              从存疑题第 {firstMarkedQuestion} 题重看
            </Link>
          )}
          {primaryFocusModule != null && (
            <Link
              href={`/practice?paper=${encodeURIComponent(paper)}&focusModule=${encodeURIComponent(primaryFocusModule)}`}
              className="block w-full py-3 border border-indigo-200 text-indigo-700 font-medium rounded-2xl text-center text-sm"
            >
              重做弱模块 {primaryFocusModule}
            </Link>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
