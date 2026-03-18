'use client'
// src/app/(app)/admin/analysis/page.tsx — 分析队列管理

import { useEffect, useState } from 'react'
import { format } from 'date-fns'

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:    { label: '待处理', color: 'bg-yellow-100 text-yellow-700' },
  processing: { label: '处理中', color: 'bg-blue-100 text-blue-600' },
  done:       { label: '已完成', color: 'bg-green-100 text-green-700' },
  failed:     { label: '失败',   color: 'bg-red-100 text-red-500' },
  skipped:    { label: '跳过',   color: 'bg-gray-100 text-gray-500' },
}

export default function AnalysisQueuePage() {
  const [data, setData]     = useState<any>(null)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  function load() {
    fetch(`/api/analysis/queue?status=${filter}`)
      .then(r => r.json()).then(d => { setData(d); setLoading(false) })
  }

  useEffect(() => { setLoading(true); load() }, [filter])

  async function resetFailed(taskId: string) {
    await fetch('/api/analysis/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset', taskId }),
    })
    load()
  }

  const counts = data?.counts ?? {}
  const total  = Object.values(counts).reduce((a: number, b: any) => a + b, 0)

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8">
      <h1 className="text-xl font-bold text-gray-900 mb-5">分析队列</h1>

      {/* 统计概览 */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
          <div key={status} className={`rounded-xl p-3 text-center cursor-pointer border-2 transition-colors
            ${filter === status ? 'border-blue-500' : 'border-transparent'}`}
            onClick={() => setFilter(status)}>
            <p className="text-xl font-bold text-gray-900">{counts[status] ?? 0}</p>
            <p className={`text-xs mt-0.5 px-1.5 py-0.5 rounded-full inline-block ${cfg.color}`}>{cfg.label}</p>
          </div>
        ))}
      </div>

      {/* 进度条 */}
      {total > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>完成进度</span>
            <span>{counts.done ?? 0} / {total}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${total > 0 ? ((counts.done ?? 0) / total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-2">
            待处理：{counts.pending ?? 0} 个 · 分析服务运行时自动消费（按 priority 排序）
          </p>
        </div>
      )}

      {/* 筛选 */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {['all', ...Object.keys(STATUS_CONFIG)].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs border transition-colors
              ${filter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-100'}`}>
            {s === 'all' ? '全部' : STATUS_CONFIG[s].label}
          </button>
        ))}
      </div>

      {/* 任务列表 */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : (
        <div className="space-y-2">
          {data?.tasks?.map((task: any) => {
            const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending
            return (
              <div key={task.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-xs font-medium text-gray-700 truncate">{task.targetId}</span>
                    <span className="text-xs text-gray-400">{task.targetType}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>优先级 {Math.round(task.priority * 100)}%</span>
                    {task.analyzedAt && <span>完成于 {format(new Date(task.analyzedAt), 'MM-dd HH:mm')}</span>}
                    {task.resultSummary && <span className="truncate max-w-[200px]">{task.resultSummary}</span>}
                    {task.failReason && <span className="text-red-400 truncate">{task.failReason}</span>}
                  </div>
                </div>
                {task.status === 'failed' && (
                  <button onClick={() => resetFailed(task.id)}
                    className="text-xs border border-gray-200 text-gray-500 px-2 py-1 rounded-lg hover:bg-gray-50">
                    重试
                  </button>
                )}
              </div>
            )
          })}
          {data?.tasks?.length === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">该状态下暂无任务</p>
          )}
        </div>
      )}
    </div>
  )
}
