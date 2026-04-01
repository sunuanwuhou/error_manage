'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { evaluateImportQuality, inferQuestionType } from '@/lib/import/quality-gate'

type PreviewItem = {
  index: number
  no: string
  content: string
  questionImage?: string
  options: string[]
  answer: string
  type: string
  analysis?: string
  rawText?: string
}

type JobDetail = {
  id: string
  filename: string
  parsedQuestions?: string
  status: string
  createdAt: string
}

type RepairItem = {
  jobId: string
  filename: string
  question: PreviewItem
  blockerLabels: string[]
}

type RepairSummary = {
  jobId: string
  filename: string
  blockerCount: number
  releasable: boolean
}

type AutoFixResponse = {
  ok: boolean
  beforeBlocked: number
  afterBlocked: number
  repairedCount: number
  stats?: {
    contentCleaned: number
    answerFilled: number
    analysisFilled: number
    optionsRecovered: number
    typeAdjusted: number
    judgmentNormalized: number
    verbalStemTrimmed: number
    quantityTypeAdjusted: number
    dataStemRecovered: number
    duplicatesRemoved: number
  }
}

type AutoFixDiffResponse = {
  ok: boolean
  jobId: string
  filename: string
  summary: {
    total: number
    changedCount: number
    unchangedCount: number
    changedFieldCounts: Record<string, number>
  }
  items: Array<{ index: number; no: string; fields: Array<{ field: string; before: string; after: string }> }>
}

export default function ImportRepairQueuePage() {
  const [jobs, setJobs] = useState<JobDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [reasonFilter, setReasonFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [fixingJobId, setFixingJobId] = useState('')
  const [loadingDiffJobId, setLoadingDiffJobId] = useState('')

  async function loadJobs() {
    setLoading(true)
    try {
      const res = await fetch('/api/import/jobs')
      const data = await res.json()
      const items = (data.items || []) as JobDetail[]
      const detailed = await Promise.all(items.slice(0, 50).map(async (job) => {
        try {
          const r = await fetch(`/api/import/jobs/${job.id}`)
          const d = await r.json()
          return d.job || job
        } catch {
          return job
        }
      }))
      setJobs(detailed)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadJobs().catch(() => setLoading(false))
  }, [])

  async function autoFixJob(jobId: string) {
    setFixingJobId(jobId)
    try {
      const res = await fetch(`/api/import/jobs/${jobId}/auto-fix`, { method: 'POST' })
      const data = await res.json() as AutoFixResponse & { error?: string }
      if (!res.ok) throw new Error(data.error || '自动修复失败')
      alert(`自动修复完成：阻断题 ${data.beforeBlocked} → ${data.afterBlocked}，净减少 ${data.repairedCount}`)
      await loadJobs()
    } catch (error: any) {
      alert(error?.message || '自动修复失败')
    } finally {
      setFixingJobId('')
    }
  }


  async function previewAutoFixDiff(jobId: string) {
    setLoadingDiffJobId(jobId)
    try {
      const res = await fetch(`/api/import/jobs/${jobId}/auto-fix-diff`)
      const data = await res.json() as AutoFixDiffResponse & { error?: string }
      if (!res.ok) throw new Error(data.error || '读取自动修复差异失败')
      const fieldSummary = Object.entries(data.summary.changedFieldCounts || {})
        .map(([k, v]) => `${k}:${v}`)
        .join('，')
      const examples = (data.items || [])
        .slice(0, 5)
        .map(item => `#${item.no} ${item.fields.map(field => field.field).join('/')}`)
        .join('\n')
      alert(`预计改动题数：${data.summary.changedCount}/${data.summary.total}\n字段统计：${fieldSummary || '无'}\n\n样例：\n${examples || '无'}`)
    } catch (error: any) {
      alert(error?.message || '读取自动修复差异失败')
    } finally {
      setLoadingDiffJobId('')
    }
  }

  const repairItems = useMemo(() => {
    const result: RepairItem[] = []
    jobs.forEach(job => {
      let parsed: any[] = []
      try {
        parsed = typeof job.parsedQuestions === 'string'
          ? JSON.parse(job.parsedQuestions)
          : Array.isArray(job.parsedQuestions)
            ? job.parsedQuestions
            : []
      } catch {
        parsed = []
      }

      parsed.forEach((raw, idx) => {
        const q: PreviewItem = {
          index: raw.index ?? idx,
          no: raw.no || String(idx + 1),
          content: raw.content || '',
          questionImage: raw.questionImage || '',
          options: raw.options || [],
          answer: raw.answer || '',
          type: inferQuestionType(raw),
          analysis: raw.analysis || '',
          rawText: raw.rawText || '',
        }
        const quality = evaluateImportQuality(q as any)
        if (quality.blockers.length) {
          result.push({
            jobId: job.id,
            filename: job.filename,
            question: q,
            blockerLabels: quality.blockers.map(item => item.label),
          })
        }
      })
    })
    return result
  }, [jobs])

  const summaryByJob = useMemo(() => {
    const map = new Map<string, RepairSummary>()
    jobs.forEach(job => {
      const blockerCount = repairItems.filter(item => item.jobId === job.id).length
      map.set(job.id, {
        jobId: job.id,
        filename: job.filename,
        blockerCount,
        releasable: blockerCount === 0,
      })
    })
    return Array.from(map.values()).sort((a, b) => a.blockerCount - b.blockerCount)
  }, [jobs, repairItems])

  const blockerReasons = useMemo(() => {
    const map: Record<string, number> = {}
    repairItems.forEach(item => {
      item.blockerLabels.forEach(label => {
        map[label] = (map[label] || 0) + 1
      })
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [repairItems])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return repairItems.filter(item => {
      const matchReason = reasonFilter === 'all' || item.blockerLabels.includes(reasonFilter)
      const matchQuery = !q || item.filename.toLowerCase().includes(q) || item.question.content.toLowerCase().includes(q)
      return matchReason && matchQuery
    })
  }, [repairItems, reasonFilter, query])

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-2xl font-semibold">导入待修复池</h1>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">阻断题总数</p>
            <p className="mt-1 text-2xl font-semibold">{repairItems.length}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">涉及导入任务</p>
            <p className="mt-1 text-2xl font-semibold">{new Set(repairItems.map(item => item.jobId)).size}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">主要阻断原因</p>
            <p className="mt-1 text-xl font-semibold">{blockerReasons[0]?.[0] || '-'}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">处理建议</p>
            <p className="mt-1 text-sm font-semibold">先修后放行</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索文件名 / 题干" className="rounded-xl border px-3 py-2 text-sm" />
          <select value={reasonFilter} onChange={e => setReasonFilter(e.target.value)} className="rounded-xl border px-3 py-2 text-sm">
            <option value="all">全部阻断原因</option>
            {blockerReasons.map(([reason]) => <option key={reason} value={reason}>{reason}</option>)}
          </select>
          <button onClick={() => loadJobs()} className="rounded-xl border px-4 py-2 text-sm">刷新</button>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">任务放行状态</h2>
          <span className="text-sm text-slate-500">{summaryByJob.length} 个任务</span>
        </div>
        <div className="mt-4 grid gap-3">
          {summaryByJob.map(item => (
            <div key={item.jobId} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{item.filename}</p>
                  <p className="mt-1 text-sm text-slate-500">阻断题：{item.blockerCount}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {item.releasable ? (
                    <>
                      <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-700">当前任务已可放行</span>
                      <Link href={`/import?loadJobId=${encodeURIComponent(item.jobId)}&readyToPublish=1`} className="rounded-xl border px-4 py-2 text-sm">
                        去发布这批题
                      </Link>
                    </>
                  ) : (
                    <>
                      <button onClick={() => previewAutoFixDiff(item.jobId)} disabled={loadingDiffJobId === item.jobId} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">
                        {loadingDiffJobId === item.jobId ? '分析中...' : '预览自动修复差异'}
                      </button>
                      <button onClick={() => autoFixJob(item.jobId)} disabled={fixingJobId === item.jobId} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">
                        {fixingJobId === item.jobId ? '自动修复中...' : '一键自动修复'}
                      </button>
                      <Link href={`/import?loadJobId=${encodeURIComponent(item.jobId)}`} className="rounded-xl border px-4 py-2 text-sm">
                        继续修这个任务
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!summaryByJob.length ? <p className="text-sm text-slate-500">暂无导入任务</p> : null}
        </div>
      </section>

      <section className="mt-6 grid gap-3">
        {loading ? <p className="text-sm text-slate-500">加载中...</p> : null}
        {!loading && !filtered.length ? <p className="text-sm text-slate-500">暂无待修复题</p> : null}

        {filtered.map(item => (
          <div key={`${item.jobId}__${item.question.index}`} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
              <span>{item.filename}</span>
              <span>题号 {item.question.no}</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {item.blockerLabels.map(label => (
                <span key={label} className="rounded-full bg-red-100 px-2 py-1 text-red-700">{label}</span>
              ))}
            </div>

            <p className="mt-3 line-clamp-3">{item.question.content}</p>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => {
                  window.location.href = `/import?loadJobId=${encodeURIComponent(item.jobId)}&focusIndex=${item.question.index}`
                }}
                className="rounded-xl border px-4 py-2 text-sm"
              >
                去修这题
              </button>
              <Link href={`/import/${item.jobId}`} className="rounded-xl border px-4 py-2 text-sm">查看任务详情</Link>
            </div>
          </div>
        ))}
      </section>
    </main>
  )
}
