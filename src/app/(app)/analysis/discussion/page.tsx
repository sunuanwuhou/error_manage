'use client'
// src/app/(app)/analysis/discussion/page.tsx
// AI 分析结果讨论页 — 确认/否定/补充每条 finding

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

interface Finding {
  type:           string
  skillTag?:      string
  title:          string
  detail:         string
  confidence:     number
  trend?:         string
  evidence:       string
  userDiscussion?: string[]  // 已有的讨论记录
}

interface Discussion {
  findingIndex:   number
  action:         string
  comment:        string | null
  confidenceDelta: number
  aiResponse:     string | null
}

const TREND_CONFIG = {
  improving:  { label: '↑ 改善中', color: 'text-green-600' },
  worsening:  { label: '↓ 变差中', color: 'text-red-500' },
  stable:     { label: '→ 稳定',   color: 'text-gray-500' },
}

const TYPE_ICONS = {
  weakness:     '⚠️',
  strength:     '✅',
  pattern:      '🔄',
  prediction:   '🔮',
  optimization: '⚡',
}

export default function DiscussionPage() {
  const params     = useSearchParams()
  const router     = useRouter()
  const snapshotId = params.get('id')

  const [findings, setFindings]     = useState<Finding[]>([])
  const [discussions, setDiscussions] = useState<Discussion[]>([])
  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState<number | null>(null)
  const [aiResponses, setAiResponses] = useState<Record<number, string>>({})

  // 当前正在操作的 finding
  const [activeIdx, setActiveIdx]   = useState<number | null>(null)
  const [comment, setComment]       = useState('')
  const [action, setAction]         = useState<'confirm' | 'refute' | 'supplement' | null>(null)

  useEffect(() => {
    if (!snapshotId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/analysis/snapshots/${snapshotId}`).then(r => r.json()),
      fetch(`/api/analysis/discussion?snapshotId=${snapshotId}`).then(r => r.json()),
    ]).then(([snap, discs]) => {
      if (snap.findings) setFindings(JSON.parse(snap.findings))
      if (Array.isArray(discs)) setDiscussions(discs)
      setLoading(false)
    })
  }, [snapshotId])

  // 获取某 finding 的已有讨论
  function getDiscForIdx(idx: number) {
    return discussions.filter(d => d.findingIndex === idx)
  }

  // 计算当前置信度（初始 + 讨论修正）
  function getEffectiveConfidence(finding: Finding, idx: number): number {
    const delta = getDiscForIdx(idx).reduce((sum, d) => sum + d.confidenceDelta, 0)
    return Math.max(0, Math.min(1, finding.confidence + delta))
  }

  async function handleSubmit(idx: number) {
    if (!action || !snapshotId) return
    if (action === 'refute' && !comment.trim()) return

    setSubmitting(idx)
    const res  = await fetch('/api/analysis/discussion', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshotId,
        findingIndex: idx,
        action,
        comment: comment.trim() || undefined,
      }),
    })
    const data = await res.json()
    setSubmitting(null)
    setActiveIdx(null)
    setComment('')
    setAction(null)

    if (data.aiResponse) {
      setAiResponses(r => ({ ...r, [idx]: data.aiResponse }))
    }

    // 刷新讨论列表
    fetch(`/api/analysis/discussion?snapshotId=${snapshotId}`)
      .then(r => r.json()).then(discs => { if (Array.isArray(discs)) setDiscussions(discs) })
  }

  if (!snapshotId) return (
    <div className="max-w-lg mx-auto px-4 pt-16 text-center text-gray-400">
      <p>缺少分析快照 ID</p>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center">←</button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">与 AI 讨论分析结果</h1>
          <p className="text-xs text-gray-400 mt-0.5">确认正确的，否定错误的，补充遗漏的</p>
        </div>
      </div>

      {/* 说明 */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 mb-5 text-xs text-blue-700">
        <p className="font-medium mb-1">💡 为什么要讨论？</p>
        <p>AI 可能产生幻觉。你的反馈会写入分析记录，下次分析时 AI 会读到，不重复同样的错误。否定的次数越多，分析越准确。</p>
      </div>

      {loading ? (
        <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : findings.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">📭</p>
          <p>暂无分析结果</p>
          <p className="text-xs mt-1">导入真题后运行分析服务</p>
        </div>
      ) : (
        <div className="space-y-4">
          {findings.map((finding, idx) => {
            const discs      = getDiscForIdx(idx)
            const confidence = getEffectiveConfidence(finding, idx)
            const isActioned = discs.length > 0
            const isRefuted  = discs.some(d => d.action === 'refute')
            const isActive   = activeIdx === idx
            const aiResp     = aiResponses[idx]

            return (
              <div key={idx} className={`bg-white rounded-2xl border shadow-sm overflow-hidden
                ${isRefuted ? 'border-red-100 opacity-70' : 'border-gray-100'}`}>

                {/* Finding 头部 */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-xl flex-shrink-0 mt-0.5">
                      {TYPE_ICONS[finding.type as keyof typeof TYPE_ICONS] ?? '📊'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-gray-900 text-sm">{finding.title}</span>
                        {finding.skillTag && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{finding.skillTag}</span>
                        )}
                        {finding.trend && TREND_CONFIG[finding.trend as keyof typeof TREND_CONFIG] && (
                          <span className={`text-xs ${TREND_CONFIG[finding.trend as keyof typeof TREND_CONFIG].color}`}>
                            {TREND_CONFIG[finding.trend as keyof typeof TREND_CONFIG].label}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{finding.detail}</p>
                      <p className="text-xs text-gray-400 mt-1">依据：{finding.evidence}</p>

                      {/* 置信度条 */}
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{
                              width:           `${confidence * 100}%`,
                              backgroundColor: confidence > 0.7 ? '#16a34a' : confidence > 0.4 ? '#f59e0b' : '#ef4444',
                            }} />
                        </div>
                        <span className="text-xs text-gray-400 tabular-nums">
                          置信度 {Math.round(confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 已有讨论记录 */}
                  {finding.userDiscussion && finding.userDiscussion.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {finding.userDiscussion.map((d, i) => (
                        <p key={i} className="text-xs text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg">{d}</p>
                      ))}
                    </div>
                  )}

                  {/* AI 回应 */}
                  {aiResp && (
                    <div className="mt-2 bg-purple-50 border border-purple-100 rounded-xl p-3">
                      <p className="text-xs text-purple-500 font-medium mb-0.5">🤖 AI 回应</p>
                      <p className="text-sm text-purple-800">{aiResp}</p>
                    </div>
                  )}
                </div>

                {/* 操作区 */}
                {!isRefuted && (
                  <div className="border-t border-gray-50 px-4 py-3">
                    {!isActive ? (
                      <div className="flex gap-2">
                        <button onClick={() => { setActiveIdx(idx); setAction('confirm') }}
                          className="flex-1 py-2 text-xs bg-green-50 text-green-700 rounded-xl border border-green-100 hover:bg-green-100 transition-colors font-medium">
                          ✅ 这个对
                        </button>
                        <button onClick={() => { setActiveIdx(idx); setAction('refute') }}
                          className="flex-1 py-2 text-xs bg-red-50 text-red-600 rounded-xl border border-red-100 hover:bg-red-100 transition-colors font-medium">
                          ❌ 不对
                        </button>
                        <button onClick={() => { setActiveIdx(idx); setAction('supplement') }}
                          className="flex-1 py-2 text-xs bg-blue-50 text-blue-600 rounded-xl border border-blue-100 hover:bg-blue-100 transition-colors font-medium">
                          💬 补充
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="flex gap-2 mb-2">
                          {(['confirm', 'refute', 'supplement'] as const).map(a => (
                            <button key={a} onClick={() => setAction(a)}
                              className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors font-medium
                                ${action === a
                                  ? a === 'confirm' ? 'bg-green-600 text-white border-green-600'
                                  : a === 'refute'  ? 'bg-red-600 text-white border-red-600'
                                  : 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white text-gray-500 border-gray-200'}`}>
                              {a === 'confirm' ? '✅ 对' : a === 'refute' ? '❌ 不对' : '💬 补充'}
                            </button>
                          ))}
                        </div>

                        {(action === 'refute' || action === 'supplement') && (
                          <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder={action === 'refute'
                              ? '请说明为什么不对（这会帮助 AI 改进）...'
                              : '补充一些 AI 遗漏的信息...'}
                            rows={3}
                            className="w-full text-sm border border-gray-200 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 mb-2"
                          />
                        )}

                        <div className="flex gap-2">
                          <button onClick={() => { setActiveIdx(null); setComment(''); setAction(null) }}
                            className="flex-1 py-2 text-xs border border-gray-200 text-gray-500 rounded-xl">
                            取消
                          </button>
                          <button
                            onClick={() => handleSubmit(idx)}
                            disabled={submitting === idx || (action === 'refute' && !comment.trim())}
                            className="flex-1 py-2 text-xs bg-blue-600 text-white rounded-xl font-medium disabled:opacity-50">
                            {submitting === idx ? '提交中...' : '提交'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isRefuted && (
                  <div className="border-t border-red-100 px-4 py-2 bg-red-50">
                    <p className="text-xs text-red-400">此结论已被否定，下次分析时 AI 会修正</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
