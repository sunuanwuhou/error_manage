'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type ParsedQuestion = {
  index?: number
  no?: string
  content?: string
  questionImage?: string
  options?: string[]
  answer?: string
  type?: string
  analysis?: string
}

type JobPayload = {
  id: string
  filename: string
  status: string
  importedCount: number
  failReason?: string | null
  createdAt: string
  parsedQuestions: ParsedQuestion[]
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    parsed: 'bg-blue-100 text-blue-700',
    reviewing: 'bg-amber-100 text-amber-700',
    done: 'bg-green-100 text-green-700',
    done_with_errors: 'bg-orange-100 text-orange-700',
    failed: 'bg-red-100 text-red-700',
  }
  return map[status] || 'bg-slate-100 text-slate-700'
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ImportJobDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [job, setJob] = useState<JobPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [showFail, setShowFail] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await fetch(`/api/import/jobs/${params.id}`)
      const data = await res.json()
      if (res.ok) setJob(data.job || null)
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [params.id])

  const failText = useMemo(() => {
    if (!job?.failReason) return ''
    return String(job.failReason)
  }, [job])

  async function deleteJob() {
    if (!job) return
    const ok = window.confirm(`确认删除导入任务：${job.filename}？`)
    if (!ok) return
    setDeleting(true)
    const res = await fetch(`/api/import/jobs/${job.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    setDeleting(false)
    if (!res.ok) {
      alert(data.error || '删除失败')
      return
    }
    router.push('/import')
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">导入任务详情</h1>
        <div className="flex gap-3">
          {job ? (
            <>
              <button onClick={() => downloadJson(`${job.filename || 'import-job'}.json`, job.parsedQuestions || [])} className="rounded-xl border px-4 py-2 text-sm">
                导出 JSON
              </button>
              <button onClick={deleteJob} disabled={deleting} className="rounded-xl border px-4 py-2 text-sm text-red-700 disabled:opacity-50">
                {deleting ? '删除中...' : '删除任务'}
              </button>
            </>
          ) : null}
          <Link href="/import" className="rounded-xl border px-4 py-2 text-sm">返回导入页</Link>
        </div>
      </div>

      {loading ? <p className="mt-6 text-slate-500">加载中...</p> : null}
      {!loading && !job ? <p className="mt-6 text-red-600">未找到导入任务</p> : null}

      {job ? (
        <>
          <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-4 text-sm">
              <div>
                <p className="text-slate-500">文件名</p>
                <p className="font-medium">{job.filename}</p>
              </div>
              <div>
                <p className="text-slate-500">状态</p>
                <p><span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge(job.status)}`}>{job.status}</span></p>
              </div>
              <div>
                <p className="text-slate-500">已入库</p>
                <p className="font-medium">{job.importedCount}</p>
              </div>
              <div>
                <p className="text-slate-500">创建时间</p>
                <p className="font-medium">{new Date(job.createdAt).toLocaleString()}</p>
              </div>
            </div>
          </section>

          {job.failReason ? (
            <section className="mt-6 rounded-2xl border bg-red-50 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-red-700">失败信息</h2>
                <button onClick={() => setShowFail(prev => !prev)} className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-700">
                  {showFail ? '收起' : '展开'}
                </button>
              </div>
              {showFail ? <pre className="mt-3 whitespace-pre-wrap text-sm text-red-700">{failText}</pre> : null}
            </section>
          ) : null}

          <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-medium">解析结果预览</h2>
            <div className="mt-4 grid gap-4">
              {job.parsedQuestions?.length ? job.parsedQuestions.slice(0, 50).map((item, idx) => (
                <article key={idx} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap gap-3 text-sm text-slate-500">
                    <span>#{item.no || idx + 1}</span>
                    <span>{item.type || '未分类'}</span>
                    <span>答案：{item.answer || '未识别'}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap">{item.content || ''}</p>
                  {item.questionImage ? <img src={item.questionImage} alt="题图" className="mt-3 max-h-64 rounded-xl border" /> : null}
                  {item.options?.length ? (
                    <div className="mt-3 grid gap-2">
                      {item.options.map((opt, j) => <div key={j} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{opt}</div>)}
                    </div>
                  ) : null}
                  {item.analysis ? <p className="mt-3 text-sm text-slate-600 whitespace-pre-wrap">解析：{item.analysis}</p> : null}
                </article>
              )) : <p className="text-slate-500">暂无解析结果</p>}
            </div>
          </section>
        </>
      ) : null}
    </main>
  )
}
