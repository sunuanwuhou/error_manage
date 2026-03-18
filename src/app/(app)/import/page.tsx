'use client'
// src/app/(app)/import/page.tsx
// 真题导入：PDF / Excel / CSV
// 流程：上传 → 解析预览 → 勾选题目 → 确认入库

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'upload' | 'preview' | 'done'

interface PreviewItem {
  index:      number
  no:         string
  content:    string
  options:    string[]
  answer:     string
  type:       string
  hasAnalysis: boolean
}

interface ParseResult {
  total:    number
  preview:  PreviewItem[]
  warnings: string[]
  payload:  string
}

interface ImportResult {
  imported:     number
  skipped:      number
  addedToErrors: number
  total:        number
}

const EXAM_TYPES = [
  { value: 'guo_kao',   label: '国考' },
  { value: 'sheng_kao', label: '省考' },
  { value: 'tong_kao',  label: '统考' },
  { value: 'common',    label: '通用' },
]

export default function ImportPage() {
  const router      = useRouter()
  const fileRef     = useRef<HTMLInputElement>(null)
  const [step, setStep]       = useState<Step>('upload')
  const [dragging, setDragging] = useState(false)

  // 上传配置
  const [examType, setExamType]   = useState('guo_kao')
  const [srcName, setSrcName]     = useState('')
  const [srcYear, setSrcYear]     = useState('')
  const [srcProvince, setSrcProvince] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // 解析结果
  const [result, setResult]       = useState<ParseResult | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [importResult, setImportResult] = useState<any>(null)
  const [selected, setSelected]   = useState<Set<number>>(new Set())
  const [addErrors, setAddErrors] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)

  // 完成结果
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  // ---- 文件处理 ----
  async function handleFile(file: File) {
    setUploadError('')
    setUploading(true)
    setUploadError('')

    const form = new FormData()
    form.append('file',     file)
    form.append('examType', examType)
    form.append('srcName',  srcName)

    try {
      const res  = await fetch('/api/import/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) { setUploadError(data.error ?? '上传失败'); return }
      setResult(data)
      // 默认全选
      setSelected(new Set(data.preview.map((p: PreviewItem) => p.index)))
      setStep('preview')
    } catch (e: any) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [examType, srcName])

  // ---- 确认入库 ----
  async function handleConfirm() {
    if (!result) return
    setConfirming(true)
    setImportResult(null)
    const res = await fetch('/api/import/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload:     result.payload,
        srcYear:     srcYear || undefined,
        srcProvince: srcProvince || undefined,
        srcSession:  srcName || undefined,
        addToErrors: Array.from(addErrors),
      }),
    })
    const data = await res.json()
    setImportResult(data)
    setConfirming(false)
    setStep('done')
  }

  // ---- 完成页 ----
  if (step === 'done' && importResult) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8 pb-8">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">✅</div>
          <h2 className="text-xl font-bold text-gray-900">导入完成</h2>
        </div>

        {/* 数量汇总 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 space-y-2 text-sm">
          {[
            { label: '新入库题目', value: importResult?.imported ?? 0,     color: 'text-blue-600' },
            { label: '重复跳过',  value: importResult?.skipped ?? 0,       color: 'text-gray-400' },
            { label: '低质量跳过', value: importResult?.lowQuality ?? 0,   color: 'text-amber-500' },
            { label: '加入待练队列', value: importResult?.imported ?? 0,   color: 'text-green-600' },
          ].map(item => (
            <div key={item.label} className="flex justify-between">
              <span className="text-gray-500">{item.label}</span>
              <span className={`font-bold ${item.color}`}>{item.value} 道</span>
            </div>
          ))}
        </div>

        {/* 考点分布 */}
        {importResult?.typeBreakdown && Object.keys(importResult.typeBreakdown).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
            <p className="text-xs font-medium text-gray-500 mb-2">考点分布</p>
            <div className="space-y-1.5">
              {Object.entries(importResult.typeBreakdown as Record<string, number>)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-20 flex-shrink-0">{type}</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full"
                        style={{ width: `${Math.round((count / (importResult?.imported ?? 1)) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 w-8 text-right">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* 质检问题（折叠） */}
        {importResult?.qualityReport?.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
            <p className="text-sm font-medium text-amber-700 mb-2">
              ⚠️ {importResult.qualityReport.length} 道题有质量问题
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {importResult.qualityReport.slice(0, 10).map((r: any, i: number) => (
                <div key={i} className="text-xs text-amber-600 flex gap-2">
                  <span className="flex-shrink-0">#{r.no}</span>
                  <span>{r.issues.join('、')}</span>
                  <span className="ml-auto flex-shrink-0">质量{r.score}%</span>
                </div>
              ))}
              {importResult.qualityReport.length > 10 && (
                <p className="text-xs text-amber-500">还有 {importResult.qualityReport.length - 10} 条...</p>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mb-5">
          导入的题目已加入今日练习队列，打开首页即可练习
        </p>
        <div className="flex gap-3">
          <button onClick={() => { setStep('upload'); setResult(null); setImportResult(null) }}
            className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-2xl font-medium">
            继续导入
          </button>
          <button onClick={() => router.push('/errors')}
            className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-bold">
            查看错题本
          </button>
        </div>
      </div>
    )
  }

  // ---- 预览确认页 ----
  if (step === 'preview' && result) {
    const allSelected = selected.size === result.preview.length

    function handleEditItem(idx: number, field: string, value: string) {
      setResult(r => r ? {
        ...r,
        preview: r.preview.map((p, i) => i === idx ? { ...p, [field]: value } : p)
      } : r)
    }
    return (
      <div className="max-w-2xl mx-auto px-4 pt-4 pb-32">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setStep('upload')} className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center">←</button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">解析预览</h1>
            <p className="text-xs text-gray-400">共 {result.total} 道题，展示前 50 道</p>
          </div>
        </div>

        {/* 警告 */}
        {result.warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-4 space-y-1">
            {result.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">⚠️ {w}</p>
            ))}
          </div>
        )}

        {/* 来源补充 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <p className="text-xs font-medium text-gray-500 mb-2">补充来源信息（可选）</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={srcYear} onChange={e => setSrcYear(e.target.value)}
              placeholder="年份，如 2024"
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <input value={srcProvince} onChange={e => setSrcProvince(e.target.value)}
              placeholder="省份（省考填）"
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>

        {/* 全选 / 加入错题本 */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setSelected(allSelected ? new Set() : new Set(result.preview.map(p => p.index)))}
            className="text-sm text-blue-600 underline">
            {allSelected ? '取消全选' : '全选'}
          </button>
          <p className="text-xs text-gray-400">
            已选 {selected.size} 道 · 加入错题本 {addErrors.size} 道
          </p>
        </div>

        {/* 题目预览列表 */}
        <div className="space-y-2 mb-4">
          {result.preview.map(item => {
            const isSel = selected.has(item.index)
            const isErr = addErrors.has(item.index)
            return (
              <div key={item.index}
                className={`bg-white rounded-2xl border shadow-sm p-3 transition-colors
                  ${isSel ? 'border-blue-200' : 'border-gray-100 opacity-50'}`}>
                <div className="flex items-start gap-2">
                  {/* 入库勾选 */}
                  <button onClick={() => {
                    setSelected(s => { const n = new Set(s); isSel ? n.delete(item.index) : n.add(item.index); return n })
                    if (isSel) setAddErrors(s => { const n = new Set(s); n.delete(item.index); return n })
                  }} className="mt-0.5 flex-shrink-0">
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center
                      ${isSel ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                      {isSel && <span className="text-white text-xs">✓</span>}
                    </div>
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-gray-400">#{item.no}</span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md">{item.type}</span>
                      {item.answer && (
                        <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded-md">答：{item.answer}</span>
                      )}
                      {item.hasAnalysis && (
                        <span className="text-xs bg-blue-50 text-blue-400 px-1.5 py-0.5 rounded-md">有解析</span>
                      )}
                    </div>
                    {editingIdx === item.index ? (
                      <textarea value={item.content}
                        onChange={e => handleEditItem(item.index, 'content', e.target.value)}
                        onBlur={() => setEditingIdx(null)}
                        autoFocus rows={3}
                        className="w-full text-sm text-gray-700 border border-blue-300 rounded-lg p-1.5 resize-none focus:outline-none"
                      />
                    ) : (
                      <p className="text-sm text-gray-700 line-clamp-2 cursor-pointer hover:text-blue-600"
                        onClick={() => setEditingIdx(item.index)}
                        title="点击编辑">
                        {item.content} <span className="text-xs text-gray-300">✏️</span>
                      </p>
                    )}
                    {item.options.length > 0 && (
                      <p className="text-xs text-gray-400 mt-1 truncate">
                        {item.options.slice(0, 2).join(' · ')}...
                      </p>
                    )}
                  </div>

                  {/* 加入错题本 */}
                  {isSel && (
                    <button onClick={() => setAddErrors(s => {
                      const n = new Set(s); isErr ? n.delete(item.index) : n.add(item.index); return n
                    })} className="flex-shrink-0 text-xs px-2 py-1 rounded-lg border transition-colors
                      ${isErr ? 'bg-red-50 border-red-200 text-red-500' : 'border-gray-100 text-gray-400 hover:border-gray-300'}">
                      {isErr ? '📕' : '📕?'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {result.total > 50 && (
          <p className="text-xs text-gray-400 text-center mb-4">
            仅预览前50道，确认后将导入全部 {result.total} 道
          </p>
        )}

        {/* 底部确认 */}
        <div className="fixed bottom-20 left-4 right-4 max-w-2xl mx-auto">
          <button onClick={handleConfirm} disabled={confirming || selected.size === 0}
            className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl text-base hover:bg-blue-700 disabled:opacity-40 shadow-lg transition-colors">
            {confirming
              ? '导入中...'
              : `确认导入 ${selected.size} 道题${addErrors.size > 0 ? `（${addErrors.size} 道加入错题本）` : ''}`}
          </button>
        </div>
      </div>
    )
  }

  // ---- 上传页 ----
  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center">←</button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">导入真题</h1>
          <p className="text-xs text-gray-400 mt-0.5">支持粉笔 / 华图 / 中公 PDF 及 Excel</p>
        </div>
      </div>

      {/* 配置 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">考试类型</label>
            <select value={examType} onChange={e => setExamType(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              {EXAM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">来源名称</label>
            <input value={srcName} onChange={e => setSrcName(e.target.value)}
              placeholder="如：2024年国考行测"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>
      </div>

      {/* 拖拽上传区 */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors
          ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}
      >
        <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <div className="text-4xl mb-3">{uploading ? '⏳' : '📂'}</div>
        {uploading ? (
          <div className="space-y-2">
            <div className="animate-spin text-3xl">⏳</div>
            <p className="font-semibold text-gray-700">解析中，请稍候...</p>
            <p className="text-xs text-gray-400">PDF 通常需要 15-30 秒</p>
            <div className="w-32 h-1 bg-gray-200 rounded-full overflow-hidden mx-auto">
              <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{width:'60%'}} />
            </div>
          </div>
        ) : (
          <>
            <p className="font-semibold text-gray-700">点击或拖拽文件到这里</p>
            <p className="text-sm text-gray-400 mt-1">PDF · Excel(.xlsx/.xls) · CSV · 最大 20MB</p>
          </>
        )}
      </div>

      {uploadError && (
        <div className="mt-3 bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl">
          {uploadError}
        </div>
      )}

      {/* 格式说明 */}
      <div className="mt-6 space-y-3">
        <p className="text-xs font-medium text-gray-500">支持的文件格式</p>
        {[
          { icon: '📄', name: 'PDF（粉笔/华图/中公）',
            desc: '自动提取题目+选项，末尾答案表自动对应。扫描版不支持（图片PDF）。' },
          { icon: '📊', name: 'Excel / CSV',
            desc: '列名含"题目/答案/A/B/C/D"即可识别，也支持粉笔导出格式。' },
        ].map(f => (
          <div key={f.name} className="flex gap-3 bg-gray-50 rounded-xl p-3">
            <span className="text-2xl flex-shrink-0">{f.icon}</span>
            <div>
              <p className="text-sm font-medium text-gray-700">{f.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{f.desc}</p>
            </div>
          </div>
        ))}

        <div className="bg-amber-50 rounded-xl p-3">
          <p className="text-xs text-amber-700">
            <span className="font-medium">Excel 模板格式：</span>
            表头至少包含：<code className="bg-amber-100 px-1 rounded">题目</code>
            <code className="bg-amber-100 px-1 rounded ml-1">A</code>
            <code className="bg-amber-100 px-1 rounded ml-1">B</code>
            <code className="bg-amber-100 px-1 rounded ml-1">C</code>
            <code className="bg-amber-100 px-1 rounded ml-1">D</code>
            <code className="bg-amber-100 px-1 rounded ml-1">答案</code>
          </p>
        </div>
      </div>
    </div>
  )
}
