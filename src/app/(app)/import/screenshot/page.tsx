'use client'
// src/app/(app)/import/screenshot/page.tsx — B6: 截图识别录题

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type DuplicateMode = 'skip' | 'replace_low_quality' | 'force_replace'

function encodePayload(question: {
  content: string
  options: string[]
  answer?: string
  analysis?: string
  type?: string
  questionImage?: string
  warnings?: string[]
}, examType: string) {
  const bytes = new TextEncoder().encode(JSON.stringify([{
    index: 0,
    no: '1',
    content: question.content,
    questionImage: question.questionImage ?? '',
    options: question.options ?? [],
    answer: question.answer ?? '',
    analysis: question.analysis ?? '',
    type: question.type ?? '判断推理',
    examType,
    srcName: '截图OCR',
    srcOrigin: 'screenshot_ocr',
  }]))
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')
  return btoa(binary)
}

export default function ScreenshotPage() {
  const router    = useRouter()
  const fileRef   = useRef<HTMLInputElement>(null)
  const [preview, setPreview]   = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<any>(null)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [myAnswer, setMyAnswer] = useState('A')
  const [examType, setExamType] = useState('common')
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('replace_low_quality')

  useEffect(() => {
    fetch('/api/onboarding')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.examType) {
          setExamType(data.examType)
        }
      })
      .catch(() => {})
  }, [])

  async function handleFile(file: File) {
    const url = URL.createObjectURL(file)
    setPreview(url)
    setResult(null); setError('')
    setLoading(true)

    const form = new FormData()
    form.append('image', file)
    form.append('examType', examType)
    form.append('srcName', '截图OCR')

    try {
      const res  = await fetch('/api/import/screenshot', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? '识别失败'); return }
      setResult(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: encodePayload(result, examType),
          srcSession: '截图OCR',
          srcOrigin: 'screenshot_ocr',
          duplicateMode,
          selected: [0],
          addToErrors: [0],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '保存失败')
        return
      }
      router.push('/errors')
    } catch (e: any) {
      setError(e.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center">←</button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">截图识别</h1>
          <p className="text-xs text-gray-400 mt-0.5">拍题目截图，AI自动识别，免手抄</p>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

      {/* 上传区 */}
      {!preview ? (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button onClick={() => { fileRef.current!.setAttribute('capture', 'environment'); fileRef.current?.click() }}
            className="aspect-square flex flex-col items-center justify-center bg-white border-2 border-dashed border-gray-200 rounded-2xl hover:border-blue-300 transition-colors">
            <span className="text-4xl">📷</span>
            <span className="text-sm text-gray-500 mt-2">拍照</span>
          </button>
          <button onClick={() => { fileRef.current!.removeAttribute('capture'); fileRef.current?.click() }}
            className="aspect-square flex flex-col items-center justify-center bg-white border-2 border-dashed border-gray-200 rounded-2xl hover:border-blue-300 transition-colors">
            <span className="text-4xl">🖼️</span>
            <span className="text-sm text-gray-500 mt-2">从相册选</span>
          </button>
        </div>
      ) : (
        <div className="mb-4">
          <img src={preview} alt="题目截图" className="w-full rounded-2xl border border-gray-100 shadow-sm" />
          <button onClick={() => { setPreview(null); setResult(null) }}
            className="mt-2 text-xs text-gray-400 underline">重新上传</button>
        </div>
      )}

      {loading && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-center text-blue-600 text-sm">
          <div className="animate-spin text-2xl mb-2">⏳</div>
          AI 识别中...
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-medium text-gray-500 mb-2">识别结果</p>
            <div className="space-y-3">
              {result.questionImage && (
                <img
                  src={result.questionImage}
                  alt="题目原图"
                  className="w-full rounded-2xl border border-gray-100 shadow-sm"
                />
              )}
              <div>
                <label className="text-xs text-gray-400">题型</label>
                <select value={result.type} onChange={e => setResult((r: any) => ({ ...r, type: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {['判断推理','言语理解','数量关系','资料分析','常识判断'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400">题目内容</label>
                <textarea value={result.content} onChange={e => setResult((r: any) => ({ ...r, content: e.target.value }))}
                  rows={4} className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              {result.options?.map((opt: string, i: number) => (
                <div key={i}>
                  <label className="text-xs text-gray-400">选项 {opt.charAt(0)}</label>
                  <input value={opt.slice(2)} onChange={e => setResult((r: any) => ({
                    ...r, options: r.options.map((o: string, j: number) => j === i ? `${o.charAt(0)}.${e.target.value}` : o)
                  }))} className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">正确答案</label>
                  <select value={result.answer || 'A'} onChange={e => setResult((r: any) => ({ ...r, answer: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    {['A','B','C','D'].map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400">我选了</label>
                  <select value={myAnswer} onChange={e => setMyAnswer(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    {['A','B','C','D'].map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {Array.isArray(result.warnings) && result.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-700 space-y-1">
              {result.warnings.map((warning: string, index: number) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-medium text-gray-500 mb-2">发现重复时</p>
            <div className="grid grid-cols-1 gap-2">
              {[
                { value: 'skip', label: '跳过', desc: '保留旧题，不覆盖。' },
                { value: 'replace_low_quality', label: '覆盖低质量旧题', desc: '新识别结果明显更完整时更新旧题。' },
                { value: 'force_replace', label: '强制覆盖', desc: '重复题直接用这次识别结果替换。' },
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

          <button onClick={handleSave} disabled={saving}
            className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl disabled:opacity-50">
            {saving ? '保存中...' : '导入题库并加入错题本'}
          </button>
        </div>
      )}
    </div>
  )
}
