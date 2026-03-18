'use client'
// src/app/(app)/knowledge/page.tsx — 好题知识库

import { useEffect, useState, useRef } from 'react'

const QUESTION_TYPES = ['判断推理','言语理解','数量关系','资料分析','常识判断']

interface KnowledgeEntry {
  id:             string
  questionType:   string
  methodName:     string
  applicableTypes: string[]
  triggerKeywords: string[]
  solutionSteps:  string[]
  exampleSolution: string
  qualityScore:   number
  usageCount:     number
  rawContent:     string
  isOwn:          boolean
  aiExtractedAt:  string | null
}

interface AIConfig {
  activeModel:     string
  hasAnthropicKey: boolean
  hasMiniMaxKey:   boolean
}

export default function KnowledgePage() {
  const [entries, setEntries]   = useState<KnowledgeEntry[]>([])
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null)
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ai/config').then(r => r.json()).then(setAiConfig)
    loadEntries()
  }, [typeFilter])

  function loadEntries() {
    setLoading(true)
    const url = `/api/knowledge${typeFilter ? `?type=${encodeURIComponent(typeFilter)}` : ''}`
    fetch(url).then(r => r.json()).then(data => { setEntries(data); setLoading(false) })
  }

  async function deleteEntry(id: string) {
    if (!confirm('删除这条知识？')) return
    await fetch(`/api/knowledge?id=${id}`, { method: 'DELETE' })
    loadEntries()
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">好题知识库</h1>
          <p className="text-xs text-gray-400 mt-0.5">喂好题给AI，提升所有题目的诊断质量</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl font-medium min-h-[44px] flex items-center">
          + 喂题
        </button>
      </div>

      {/* AI 模型状态 */}
      {aiConfig && (
        <div className={`rounded-2xl border p-3 mb-4 text-sm
          ${aiConfig.hasAnthropicKey
            ? 'bg-purple-50 border-purple-200 text-purple-700'
            : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${aiConfig.hasAnthropicKey ? 'bg-purple-500' : 'bg-gray-400'}`} />
            <span className="font-medium">
              {aiConfig.hasAnthropicKey
                ? `✨ 使用 Claude (${aiConfig.activeModel})`
                : `使用 MiniMax（配置 ANTHROPIC_API_KEY 切换到 Claude）`}
            </span>
          </div>
          {!aiConfig.hasAnthropicKey && (
            <p className="text-xs mt-1 opacity-70">
              在 .env.local 中添加 ANTHROPIC_API_KEY=sk-ant-... 即可切换到 Claude
            </p>
          )}
        </div>
      )}

      {/* 题型筛选 */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {['', ...QUESTION_TYPES].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs border transition-colors
              ${typeFilter === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-100'}`}>
            {t || '全部'}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400 mb-3">共 {entries.length} 条解法模式</p>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">🧪</p>
          <p className="font-medium">还没有知识库条目</p>
          <p className="text-sm mt-1">把好题喂给AI，提升诊断质量</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(e => (
            <div key={e.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <button onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                className="w-full text-left p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{e.questionType}</span>
                      <span className="font-medium text-gray-900 text-sm">{e.methodName}</span>
                      {e.isOwn && <span className="text-xs text-gray-300">我的</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span>质量 {Math.round(e.qualityScore * 100)}%</span>
                      <span>被引用 {e.usageCount} 次</span>
                      {e.triggerKeywords.slice(0, 3).map(k => (
                        <span key={k} className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">"{k}"</span>
                      ))}
                    </div>
                  </div>
                  <span className="text-gray-300 flex-shrink-0">{expanded === e.id ? '▲' : '▼'}</span>
                </div>
              </button>

              {expanded === e.id && (
                <div className="px-4 pb-4 border-t border-gray-50 pt-3 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">适用范围</p>
                    <div className="flex flex-wrap gap-1">
                      {e.applicableTypes.map(t => (
                        <span key={t} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">解题步骤</p>
                    <ol className="space-y-1">
                      {e.solutionSteps.map((step, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2">
                          <span className="text-blue-500 font-bold flex-shrink-0">{i+1}.</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {e.exampleSolution && (
                    <div className="bg-blue-50 rounded-xl p-3">
                      <p className="text-xs font-medium text-blue-500 mb-1">示范解答</p>
                      <p className="text-sm text-blue-800 leading-relaxed">{e.exampleSolution}</p>
                    </div>
                  )}

                  {e.isOwn && (
                    <button onClick={() => deleteEntry(e.id)}
                      className="text-xs text-red-400 underline">删除</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && <FeedQuestionForm onClose={() => { setShowForm(false); loadEntries() }} />}
    </div>
  )
}

// ── 喂题表单 ────────────────────────────────────────────────
function FeedQuestionForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    questionType:    '判断推理',
    questionContent: '',
    analysisContent: '',
    isPublic:        true,
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<any>(null)
  const [error, setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.questionContent || !form.analysisContent) { setError('请填写题目和解析'); return }
    setLoading(true); setError(''); setResult(null)

    const res  = await fetch('/api/knowledge', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) { setError(data.error ?? '提取失败'); return }
    setResult(data.pattern)
  }

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
        <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">✨</div>
            <h3 className="font-bold text-lg text-gray-900">AI 提取成功！</h3>
            <p className="text-sm text-gray-500 mt-1">解法模式已加入知识库，将用于提升后续诊断</p>
          </div>

          <div className="bg-blue-50 rounded-2xl p-4 space-y-2 mb-5">
            <p className="font-semibold text-blue-900">{result.methodName}</p>
            <div className="flex flex-wrap gap-1">
              {result.applicableTypes?.map((t: string) => (
                <span key={t} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
            <p className="text-sm text-blue-700">{result.summary}</p>
            <p className="text-xs text-blue-400">质量评分：{Math.round((result.qualityScore ?? 0) * 100)}%</p>
          </div>

          <button onClick={onClose}
            className="w-full py-3 bg-blue-600 text-white font-bold rounded-2xl">
            完成
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold text-lg text-gray-900">喂一道好题给 AI</h3>
            <p className="text-xs text-gray-400 mt-0.5">AI 会提取解法模式，用于提升后续所有题目的诊断质量</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">题型</label>
            <select value={form.questionType} onChange={e => setForm(f => ({ ...f, questionType: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              {QUESTION_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              好题内容 <span className="text-gray-400 font-normal">（粘贴题目原文）</span>
            </label>
            <textarea value={form.questionContent}
              onChange={e => setForm(f => ({ ...f, questionContent: e.target.value }))}
              rows={4} placeholder="粘贴一道你觉得解析很好的题目..."
              className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              required />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              高质量解析 <span className="text-gray-400 font-normal">（粘贴好的解析过程）</span>
            </label>
            <textarea value={form.analysisContent}
              onChange={e => setForm(f => ({ ...f, analysisContent: e.target.value }))}
              rows={5} placeholder="粘贴这道题的优质解析，步骤越清晰越好..."
              className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              required />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={form.isPublic}
              onChange={e => setForm(f => ({ ...f, isPublic: e.target.checked }))} />
            分享给所有用户（公共知识库，帮助更多人）
          </label>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl disabled:opacity-50">
            {loading ? '🤖 AI 提取解法模式中...' : '✨ 喂给 AI 提取解法'}
          </button>
        </form>
      </div>
    </div>
  )
}
