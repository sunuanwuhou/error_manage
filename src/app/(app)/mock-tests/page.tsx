'use client'
// src/app/(app)/mock-tests/page.tsx — 模拟考成绩录入 + 趋势

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'

interface MockRecord {
  id: string
  sourceName: string
  examType: string
  totalScore: number
  totalScoreMax: number
  scoreJson: Record<string, number> | null
  testDate: string
  daysToExam: number | null
  notes: string | null
}

const SECTION_COLORS: Record<string, string> = {
  '资料分析': 'bg-blue-500',
  '判断推理': 'bg-purple-500',
  '言语理解': 'bg-green-500',
  '数量关系': 'bg-orange-500',
  '常识判断': 'bg-gray-400',
}

export default function MockTestsPage() {
  const router  = useRouter()
  const [records, setRecords]   = useState<MockRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  function loadRecords() {
    setError('')
    fetch('/api/mock-tests')
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '模考记录加载失败')
        setRecords(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch((e: any) => {
        setRecords([])
        setError(e?.message ?? '模考记录加载失败')
        setLoading(false)
      })
  }

  useEffect(() => { loadRecords() }, [])

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">模拟考成绩</h1>
          <p className="text-xs text-gray-400 mt-0.5">记录每次模考，追踪分数趋势</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl font-medium min-h-[44px]">
          + 录入
        </button>
      </div>

      {/* 趋势迷你图 */}
      {records.length >= 2 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <p className="text-xs font-medium text-gray-500 mb-3">分数趋势</p>
          <div className="flex items-end gap-1.5 h-16">
            {records.slice(0, 10).reverse().map((r, i) => {
              const pct = (r.totalScore / r.totalScoreMax) * 100
              return (
                <div key={r.id} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t-sm bg-blue-500 transition-all"
                    style={{ height: `${pct}%`, minHeight: 4 }} />
                  <span className="text-xs text-gray-400 tabular-nums">{r.totalScore}</span>
                </div>
              )
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-300 mt-1">
            <span>早</span><span>近</span>
          </div>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600">
          {error}
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📝</p>
          <p className="font-medium">还没有模考记录</p>
          <p className="text-sm mt-1">录入第一次模考成绩</p>
          <button onClick={() => setShowForm(true)}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium">
            录入成绩
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map(r => {
            const pct = Math.round((r.totalScore / r.totalScoreMax) * 100)
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{r.sourceName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {format(new Date(r.testDate), 'MM月dd日')}
                      {r.daysToExam != null && ` · 距考试${r.daysToExam}天`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-gray-900">{r.totalScore}</p>
                    <p className="text-xs text-gray-400">/{r.totalScoreMax} · {pct}%</p>
                  </div>
                </div>

                {/* 分值条 */}
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${pct}%` }} />
                </div>

                {/* 各题型得分 */}
                {r.scoreJson && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {Object.entries(r.scoreJson).map(([type, score]) => (
                      <span key={type} className="text-xs bg-gray-50 text-gray-600 px-2 py-0.5 rounded-lg border border-gray-100">
                        {type} {score}
                      </span>
                    ))}
                  </div>
                )}

                {r.notes && (
                  <p className="text-xs text-gray-400 mt-2 italic">"{r.notes}"</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <NewMockTestModal
          onClose={() => { setShowForm(false); loadRecords() }}
        />
      )}
    </div>
  )
}

// ─── 录入弹窗 ───────────────────────────────────────────────
function NewMockTestModal({ onClose }: { onClose: () => void }) {
  const SECTIONS = ['资料分析', '判断推理', '言语理解', '数量关系', '常识判断']
  const [showMeta, setShowMeta] = useState(false)
  const [form, setForm] = useState({
    sourceName:    '',
    examType:      'guo_kao',
    totalScore:    0,
    totalScoreMax: 100,
    testDate:      new Date().toISOString().split('T')[0],
    notes:         '',
  })
  const [scores, setScores]   = useState<Record<string, string>>({})
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    fetch('/api/onboarding')
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return
        setForm(current => ({ ...current, examType: data.examType || current.examType }))
      })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const scoreJson: Record<string, number> = {}
    Object.entries(scores).forEach(([k, v]) => { if (v) scoreJson[k] = Number(v) })

    const res = await fetch('/api/mock-tests', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        totalScore:    Number(form.totalScore),
        totalScoreMax: Number(form.totalScoreMax),
        scoreJson: Object.keys(scoreJson).length > 0 ? scoreJson : undefined,
      }),
    })
    setSaving(false)
    if (res.ok) onClose()
    else { const d = await res.json(); setError(d.error ?? '保存失败') }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50">
      <div className="bg-white rounded-t-3xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg text-gray-900">录入模考成绩</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-800">模考来源</p>
                <p className="text-xs text-gray-400 mt-1">
                  默认按 {form.examType === 'guo_kao' ? '国考' : form.examType === 'sheng_kao' ? '省考' : '统考'} 记录
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMeta(v => !v)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600"
              >
                {showMeta ? '收起' : '修改'}
              </button>
            </div>
            {showMeta && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">考试类型</label>
                <select
                  value={form.examType}
                  onChange={e => setForm(f => ({ ...f, examType: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="guo_kao">国考</option>
                  <option value="sheng_kao">省考</option>
                  <option value="tong_kao">统考</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">来源名称 *</label>
            <input value={form.sourceName} onChange={e => setForm(f => ({ ...f, sourceName: e.target.value }))}
              placeholder="如：2024年国考真题 / 粉笔模拟卷#3"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              required />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">考试日期</label>
              <input type="date" value={form.testDate} onChange={e => setForm(f => ({ ...f, testDate: e.target.value }))}
                className="w-full px-2 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">总分 *</label>
              <input type="number" value={form.totalScore} min={0} max={150}
                onChange={e => setForm(f => ({ ...f, totalScore: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">满分</label>
              <input type="number" value={form.totalScoreMax} min={50} max={150}
                onChange={e => setForm(f => ({ ...f, totalScoreMax: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>

          {/* 各题型得分（可选） */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">各题型得分（可选）</label>
            <div className="grid grid-cols-3 gap-2">
              {SECTIONS.map(s => (
                <div key={s}>
                  <p className="text-xs text-gray-400 mb-1">{s}</p>
                  <input type="number" value={scores[s] ?? ''} min={0} max={50}
                    onChange={e => setScores(sc => ({ ...sc, [s]: e.target.value }))}
                    placeholder="分"
                    className="w-full px-2 py-2 border border-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">本次总结（可选）</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="如：资料分析超时，数量关系放弃..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-2xl font-medium">取消</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-bold disabled:opacity-50">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
