'use client'
// src/app/(app)/import/page.tsx
// 真题导入：DOCX
// 流程：上传 → 解析预览 → 勾选题目 → 确认入库

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'upload' | 'preview' | 'done'
type DuplicateMode = 'skip' | 'replace_low_quality' | 'force_replace'

interface PreviewItem {
  index:      number
  no:         string
  content:    string
  questionImage?: string
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

interface PayloadQuestion {
  index: number
  no: string
  content: string
  questionImage?: string
  options: string[]
  answer: string
  type: string
  analysis?: string
  examType: string
  srcName: string
}

interface ImportResult {
  imported:     number
  skipped:      number
  overwritten:  number
  addedToErrors: number
  lowQuality:   number
  total:        number
  typeBreakdown: Record<string, number>
  qualityReport: Array<{ no: string; score: number; issues: string[] }>
}

const EXAM_TYPES = [
  { value: 'guo_kao',   label: '国考' },
  { value: 'sheng_kao', label: '省考' },
  { value: 'tong_kao',  label: '统考' },
  { value: 'common',    label: '通用' },
]

const IMPORT_PREFS_KEY = 'pref_import_settings_v2'
const PROVINCES = [
  '北京', '天津', '上海', '重庆', '河北', '河南', '云南', '辽宁', '黑龙江', '湖南',
  '安徽', '山东', '新疆', '江苏', '浙江', '江西', '湖北', '广西', '甘肃', '山西',
  '内蒙古', '陕西', '吉林', '福建', '贵州', '广东', '青海', '西藏', '四川', '宁夏',
  '海南',
]

function inferImportMeta(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, '').trim()
  const yearMatch = baseName.match(/\b(20\d{2})\b|((?:20\d{2})年)/)
  const year = yearMatch?.[1] ?? yearMatch?.[2]?.replace('年', '') ?? ''

  let inferredExamType = ''
  if (/国考|国家公务员/.test(baseName)) inferredExamType = 'guo_kao'
  else if (/联考|统考/.test(baseName)) inferredExamType = 'tong_kao'
  else if (/省考/.test(baseName)) inferredExamType = 'sheng_kao'

  const province = PROVINCES.find(name => baseName.includes(name)) ?? ''

  return {
    srcName: baseName,
    srcYear: year,
    examType: inferredExamType,
    srcProvince: province,
  }
}

function decodePayload(payload: string): PayloadQuestion[] {
  const binary = atob(payload)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

function encodePayload(questions: PayloadQuestion[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(questions))
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')
  return btoa(binary)
}

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
  const [selected, setSelected]   = useState<Set<number>>(new Set())
  const [addErrors, setAddErrors] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [showImportSettings, setShowImportSettings] = useState(false)
  const [showPreviewMeta, setShowPreviewMeta] = useState(false)
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip')

  // 完成结果
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [prefsLoaded, setPrefsLoaded] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(IMPORT_PREFS_KEY)
      if (!raw) {
        setPrefsLoaded(true)
        return
      }
      const saved = JSON.parse(raw) as {
        srcName?: string
        srcYear?: string
        srcProvince?: string
      }
      if (saved.srcName) setSrcName(saved.srcName)
      if (saved.srcYear) setSrcYear(saved.srcYear)
      if (saved.srcProvince) setSrcProvince(saved.srcProvince)
    } catch {}
    finally {
      setPrefsLoaded(true)
    }
  }, [])

  useEffect(() => {
    fetch('/api/onboarding')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        setExamType(data.examType || 'guo_kao')
        setSrcProvince(current => current || data.targetProvince || '')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!prefsLoaded) return
    try {
      localStorage.setItem(IMPORT_PREFS_KEY, JSON.stringify({
        srcName,
        srcYear,
        srcProvince,
      }))
    } catch {}
  }, [prefsLoaded, srcName, srcYear, srcProvince])

  // ---- 文件处理 ----
  async function handleFile(file: File) {
    setUploadError('')
    setUploading(true)
    setUploadError('')

    const lowerName = file.name.toLowerCase()
    if (!lowerName.endsWith('.docx')) {
      setUploading(false)
      setUploadError(lowerName.endsWith('.doc') ? '暂不直接支持 .doc，请先另存为 .docx 后再导入' : '当前只支持 DOCX 导入，请上传 .docx 文件')
      return
    }

    const inferred = inferImportMeta(file.name)
    const effectiveExamType = examType || inferred.examType || 'guo_kao'
    const effectiveSrcName = srcName.trim() || inferred.srcName
    if (!srcName.trim() && inferred.srcName) setSrcName(inferred.srcName)
    if (!srcYear.trim() && inferred.srcYear) setSrcYear(inferred.srcYear)
    if (!srcProvince.trim() && inferred.srcProvince) setSrcProvince(inferred.srcProvince)
    if (examType === 'guo_kao' && inferred.examType && inferred.examType !== examType) setExamType(inferred.examType)

    const form = new FormData()
    form.append('file',     file)
    form.append('examType', effectiveExamType)
    form.append('srcName',  effectiveSrcName)

    try {
      const res  = await fetch('/api/import/upload', { method: 'POST', body: form })
      const text = await res.text()
      let data: any
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(`解析接口返回异常（HTTP ${res.status}）`)
      }
      if (!res.ok) { setUploadError(data.error ?? '上传失败'); return }
      setResult(data)
      // 默认选中整份文件，而不是只选预览区前 50 题
      setSelected(new Set(Array.from({ length: data.total }, (_, i) => i)))
      setStep('preview')
    } catch (e: any) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

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
        duplicateMode,
        addToErrors: Array.from(addErrors),
        selected:    Array.from(selected),
      }),
    })
    const data = await res.json()
    setImportResult(data)
    setConfirming(false)
    if (!res.ok) {
      setUploadError(data.error ?? '导入失败')
      return
    }
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
            { label: '覆盖更新',  value: importResult?.overwritten ?? 0,   color: 'text-violet-600' },
            { label: '低质量跳过', value: importResult?.lowQuality ?? 0,   color: 'text-amber-500' },
            { label: '加入待练队列', value: (importResult?.imported ?? 0) + (importResult?.overwritten ?? 0),   color: 'text-green-600' },
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
          导入的题目已加入真题练习队列，打开首页即可开始练习
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
    const allSelected = result.preview.every(item => selected.has(item.index))

    function handleEditItem(idx: number, field: string, value: string) {
      setResult(current => {
        if (!current) return current

        const nextPreview = current.preview.map(item =>
          item.index === idx ? { ...item, [field]: value } : item
        )

        const payloadQuestions = decodePayload(current.payload).map(question =>
          question.index === idx ? { ...question, [field]: value } : question
        )

        return {
          ...current,
          preview: nextPreview,
          payload: encodePayload(payloadQuestions),
        }
      })
    }
    return (
      <div className="max-w-2xl mx-auto px-4 pt-4 pb-32 lg:pb-8">
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 lg:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">识别有误时修改</p>
              <p className="text-sm text-gray-700">
                {[
                  srcYear ? `年份 ${srcYear}` : '年份自动识别',
                  srcProvince ? `省份 ${srcProvince}` : '省份自动识别',
                ].join(' · ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPreviewMeta(v => !v)}
              className="flex-shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
            >
              {showPreviewMeta ? '收起' : '修改'}
            </button>
          </div>
          {showPreviewMeta && (
            <div className="grid grid-cols-2 gap-2 mt-4 lg:grid-cols-4">
              <input value={srcYear} onChange={e => setSrcYear(e.target.value)}
                placeholder="年份，如 2024"
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <input value={srcProvince} onChange={e => setSrcProvince(e.target.value)}
                placeholder="省份（省考填）"
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 lg:p-5">
          <p className="text-xs font-medium text-gray-500 mb-2">发现重复时</p>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
            {[
              { value: 'skip', label: '跳过', desc: '保留旧题，重复题不动。' },
              { value: 'replace_low_quality', label: '覆盖低质量旧题', desc: '只在新结果明显更完整时更新。' },
              { value: 'force_replace', label: '强制覆盖', desc: '只要重复就用新结果替换旧题。' },
            ].map(item => (
              <button
                key={item.value}
                type="button"
                onClick={() => setDuplicateMode(item.value as DuplicateMode)}
                className={`rounded-2xl border px-3 py-3 text-left transition-colors ${
                  duplicateMode === item.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <p className={`text-sm font-medium ${duplicateMode === item.value ? 'text-blue-700' : 'text-gray-700'}`}>{item.label}</p>
                <p className="mt-1 text-xs text-gray-400">{item.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 全选 / 加入错题本 */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setSelected(s => {
            const next = new Set(s)
            if (allSelected) {
              result.preview.forEach(item => next.delete(item.index))
            } else {
              result.preview.forEach(item => next.add(item.index))
            }
            return next
          })}
            className="text-sm text-blue-600 underline">
            {allSelected ? '取消预览区勾选' : '勾选预览区'}
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
                className={`bg-white rounded-2xl border shadow-sm p-3 transition-colors lg:p-4
                  ${isSel ? 'border-blue-200' : 'border-gray-100 opacity-50'}`}>
                <div className="flex items-start gap-2 lg:gap-3">
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
                        autoFocus rows={4}
                        className="w-full text-sm text-gray-700 border border-blue-300 rounded-lg p-1.5 resize-none focus:outline-none"
                      />
                    ) : (
                      <p className="text-sm text-gray-700 line-clamp-3 cursor-pointer hover:text-blue-600"
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
        <div className="fixed bottom-20 left-4 right-4 max-w-2xl mx-auto lg:static lg:mt-6 lg:max-w-none">
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
          <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">导入真题</h1>
          <p className="text-xs text-gray-400 mt-0.5">当前主入口只支持 Word DOCX 导入</p>
        </div>
      </div>

      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4 mb-4 lg:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500 mb-1">自动识别</p>
            <p className="text-sm text-gray-700">年份、考试类型和省份会自动从文件名和本机偏好里带入。</p>
            <p className="text-xs text-gray-400 mt-1">
              只有识别有误时，再展开高级选项修改。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowImportSettings(value => !value)}
            className="flex-shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
          >
            {showImportSettings ? '收起' : '高级选项'}
          </button>
        </div>

        {showImportSettings && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">年份</label>
                <input value={srcYear} onChange={e => setSrcYear(e.target.value)}
                  placeholder="如：2024"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">省份</label>
                <input value={srcProvince} onChange={e => setSrcProvince(e.target.value)}
                  placeholder="省考时填写"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
          </div>
        )}
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
        <input ref={fileRef} type="file" accept=".docx" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <div className="text-4xl mb-3">{uploading ? '⏳' : '📂'}</div>
        {uploading ? (
          <div className="space-y-2">
            <div className="animate-spin text-3xl">⏳</div>
            <p className="font-semibold text-gray-700">解析中，请稍候...</p>
            <p className="text-xs text-gray-400">DOCX 正在提取题干、材料图和图片选项</p>
            <div className="w-32 h-1 bg-gray-200 rounded-full overflow-hidden mx-auto">
              <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{width:'60%'}} />
            </div>
          </div>
        ) : (
          <>
            <p className="font-semibold text-gray-700">点击或拖拽文件到这里</p>
            <p className="text-sm text-gray-400 mt-1">仅支持 DOCX · 最大 20MB</p>
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
        <p className="text-xs font-medium text-gray-500">推荐导入格式</p>
        {[
          { icon: '📝', name: 'DOCX（Word 题库文档）',
            desc: '当前正式入口只支持 DOCX，会优先保留题干内联图、资料分析材料图和图片选项。' },
          { icon: '⚠️', name: '.doc（旧版 Word）',
            desc: '请先在 Word 里另存为 .docx，再导入系统。' },
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
            <span className="font-medium">导入建议：</span>
            图片题、资料分析、图形推理和题干内嵌小公式，优先使用 <code className="bg-amber-100 px-1 rounded">DOCX</code>。
          </p>
        </div>
      </div>
    </div>
  )
}
