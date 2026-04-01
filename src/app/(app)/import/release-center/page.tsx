'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type OverviewItem = {
  id: string
  filename: string
  status: string
  importedCount: number
  createdAt: string
  failReason?: string | null
  releaseStatus: 'ready' | 'partial' | 'blocked'
  insight: {
    total: number
    readyCount: number
    blockedCount: number
    warningCount: number
    topBlocker?: string
    topWarning?: string
  }
}

type OverviewResponse = {
  summary: {
    jobs: number
    totalQuestions: number
    readyQuestions: number
    blockedQuestions: number
    warningQuestions: number
    readyJobs: number
    partialJobs: number
    blockedJobs: number
  }
  topBlockers: Array<{ label: string; count: number }>
  topWarnings: Array<{ label: string; count: number }>
  items: OverviewItem[]
}

type ReleasePlan = {
  job: {
    id: string
    filename: string
    status: string
    createdAt: string
    importedCount: number
  }
  insight: {
    total: number
    blockedCount: number
    warningCount: number
    readyCount: number
    blockerReasons: Array<{ label: string; count: number }>
    warningReasons: Array<{ label: string; count: number }>
    fileBreakdown: Array<{ label: string; total: number; blockedCount: number; readyCount: number; warningCount: number }>
    recommendedPublishIndexes: number[]
  }
  releaseAdvice: {
    canPublishAll: boolean
    canPublishRecommendedSubset: boolean
    recommendedPublishIndexes: number[]
    blockedQuestions: Array<{ index: number; no: string; content: string; fileName?: string; relativePath?: string; blockers: string[] }>
    focusFiles: Array<{ label: string; total: number; blockedCount: number; readyCount: number; warningCount: number }>
  }
}

function releaseBadge(status: OverviewItem['releaseStatus']) {
  if (status === 'ready') return 'bg-green-100 text-green-700'
  if (status === 'partial') return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-700'
}

export default function ImportReleaseCenterPage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeJobId, setActiveJobId] = useState('')
  const [plan, setPlan] = useState<ReleasePlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [releaseFilter, setReleaseFilter] = useState<'all' | 'ready' | 'partial' | 'blocked'>('all')

  async function loadOverview() {
    setLoading(true)
    try {
      const res = await fetch('/api/import/overview')
      const data = await res.json()
      setOverview(data)
      if (!activeJobId && data.items?.[0]?.id) setActiveJobId(data.items[0].id)
    } finally {
      setLoading(false)
    }
  }

  async function loadPlan(jobId: string) {
    if (!jobId) return
    setPlanLoading(true)
    try {
      const res = await fetch(`/api/import/jobs/${jobId}/release-plan`)
      const data = await res.json()
      setPlan(data)
    } finally {
      setPlanLoading(false)
    }
  }

  useEffect(() => {
    loadOverview().catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (activeJobId) loadPlan(activeJobId).catch(() => setPlanLoading(false))
  }, [activeJobId])

  const filteredItems = useMemo(() => {
    const items = overview?.items || []
    return items.filter(item => {
      const matchRelease = releaseFilter === 'all' || item.releaseStatus === releaseFilter
      const q = query.trim().toLowerCase()
      const matchQuery = !q || item.filename.toLowerCase().includes(q)
      return matchRelease && matchQuery
    })
  }, [overview, query, releaseFilter])

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">导入发布中控台</h1>
          <p className="mt-1 text-sm text-slate-500">先看哪批可发，再决定修哪里，避免今晚批量导入后还要逐个翻任务。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/import" className="rounded-xl border px-4 py-2 text-sm">返回导入页</Link>
          <Link href="/import/repair-queue" className="rounded-xl border px-4 py-2 text-sm">查看待修复池</Link>
          <button onClick={() => loadOverview()} className="rounded-xl border px-4 py-2 text-sm">刷新</button>
        </div>
      </div>

      <section className="mt-6 grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">导入任务</p>
          <p className="mt-2 text-2xl font-semibold">{overview?.summary.jobs || 0}</p>
          <p className="mt-1 text-xs text-slate-500">可发 {overview?.summary.readyJobs || 0} / 部分可发 {overview?.summary.partialJobs || 0}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">题目总量</p>
          <p className="mt-2 text-2xl font-semibold">{overview?.summary.totalQuestions || 0}</p>
          <p className="mt-1 text-xs text-slate-500">可直接发 {overview?.summary.readyQuestions || 0}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">阻断题</p>
          <p className="mt-2 text-2xl font-semibold">{overview?.summary.blockedQuestions || 0}</p>
          <p className="mt-1 text-xs text-slate-500">先修后放行</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">告警题</p>
          <p className="mt-2 text-2xl font-semibold">{overview?.summary.warningQuestions || 0}</p>
          <p className="mt-1 text-xs text-slate-500">可带风险发布或复核后发布</p>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">任务列表</h2>
            <div className="flex flex-wrap gap-3">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索文件名" className="rounded-xl border px-3 py-2 text-sm" />
              <select value={releaseFilter} onChange={e => setReleaseFilter(e.target.value as any)} className="rounded-xl border px-3 py-2 text-sm">
                <option value="all">全部任务</option>
                <option value="ready">可直接发布</option>
                <option value="partial">部分可发布</option>
                <option value="blocked">当前阻断</option>
              </select>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {loading ? <p className="text-sm text-slate-500">加载中...</p> : null}
            {!loading && !filteredItems.length ? <p className="text-sm text-slate-500">暂无任务</p> : null}
            {filteredItems.map(item => (
              <button
                type="button"
                key={item.id}
                onClick={() => setActiveJobId(item.id)}
                className={`w-full rounded-2xl border p-4 text-left transition ${activeJobId === item.id ? 'border-slate-900 bg-slate-50' : 'hover:bg-slate-50'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.filename}</p>
                    <p className="mt-1 text-sm text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-sm ${releaseBadge(item.releaseStatus)}`}>
                    {item.releaseStatus === 'ready' ? '可直接发' : item.releaseStatus === 'partial' ? '部分可发' : '当前阻断'}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-4">
                  <span>总题数：{item.insight.total}</span>
                  <span>可发：{item.insight.readyCount}</span>
                  <span>阻断：{item.insight.blockedCount}</span>
                  <span>告警：{item.insight.warningCount}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                  {item.insight.topBlocker ? <span>主要阻断：{item.insight.topBlocker}</span> : null}
                  {item.insight.topWarning ? <span>主要告警：{item.insight.topWarning}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">当前任务放行建议</h2>
            {plan?.job?.id ? <Link href={`/import?loadJobId=${encodeURIComponent(plan.job.id)}`} className="rounded-xl border px-3 py-2 text-sm">打开该任务</Link> : null}
          </div>
          {planLoading ? <p className="mt-4 text-sm text-slate-500">分析中...</p> : null}
          {!planLoading && !plan ? <p className="mt-4 text-sm text-slate-500">请选择左侧任务</p> : null}
          {!planLoading && plan ? (
            <div className="mt-4 space-y-5">
              <div className="rounded-xl bg-slate-50 p-4 text-sm">
                <p className="font-medium">{plan.job.filename}</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <span>总题数：{plan.insight.total}</span>
                  <span>可直接发：{plan.insight.readyCount}</span>
                  <span>阻断题：{plan.insight.blockedCount}</span>
                  <span>告警题：{plan.insight.warningCount}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {plan.releaseAdvice.canPublishAll ? (
                    <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-700">这一批可以整批发布</span>
                  ) : plan.releaseAdvice.canPublishRecommendedSubset ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800">建议先发布可用子集，再修阻断题</span>
                  ) : (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-sm text-red-700">建议先修阻断题，不要直接发布</span>
                  )}
                  {plan.releaseAdvice.canPublishRecommendedSubset ? (
                    <Link href={`/import?loadJobId=${encodeURIComponent(plan.job.id)}&readyToPublish=1`} className="rounded-xl border px-3 py-2 text-sm">
                      去发布建议子集
                    </Link>
                  ) : null}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-slate-700">重点问题</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {plan.insight.blockerReasons.slice(0, 6).map(item => (
                    <span key={item.label} className="rounded-full bg-red-100 px-3 py-1 text-sm text-red-700">{item.label} × {item.count}</span>
                  ))}
                  {!plan.insight.blockerReasons.length ? <span className="text-sm text-slate-500">没有阻断项</span> : null}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-slate-700">问题集中在哪些文件</h3>
                <div className="mt-3 space-y-2">
                  {plan.releaseAdvice.focusFiles.slice(0, 6).map(item => (
                    <div key={item.label} className="rounded-xl border p-3 text-sm">
                      <p className="font-medium">{item.label}</p>
                      <p className="mt-1 text-slate-500">总题数 {item.total} · 阻断 {item.blockedCount} · 可发 {item.readyCount}</p>
                    </div>
                  ))}
                  {!plan.releaseAdvice.focusFiles.length ? <p className="text-sm text-slate-500">没有问题集中文件</p> : null}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-slate-700">前 10 个阻断题</h3>
                <div className="mt-3 space-y-2">
                  {plan.releaseAdvice.blockedQuestions.slice(0, 10).map(item => (
                    <div key={item.index} className="rounded-xl border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>题号 {item.no}</span>
                        <span className="text-slate-500">{item.relativePath || item.fileName || '未标记来源文件'}</span>
                      </div>
                      <p className="mt-2 line-clamp-2">{item.content}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.blockers.map(label => (
                          <span key={label} className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700">{label}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!plan.releaseAdvice.blockedQuestions.length ? <p className="text-sm text-slate-500">当前没有阻断题</p> : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium">全局高频阻断原因</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {(overview?.topBlockers || []).map(item => (
              <span key={item.label} className="rounded-full bg-red-100 px-3 py-1 text-sm text-red-700">{item.label} × {item.count}</span>
            ))}
            {!overview?.topBlockers?.length ? <p className="text-sm text-slate-500">暂无阻断项</p> : null}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium">全局高频告警</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {(overview?.topWarnings || []).map(item => (
              <span key={item.label} className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800">{item.label} × {item.count}</span>
            ))}
            {!overview?.topWarnings?.length ? <p className="text-sm text-slate-500">暂无告警项</p> : null}
          </div>
        </div>
      </section>
    </main>
  )
}
