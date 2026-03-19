'use client'
import React from 'react'
// src/app/(app)/errors/new/page.tsx
// 手动录题（P1）

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const QUESTION_TYPES = ['判断推理', '言语理解', '数量关系', '资料分析', '常识判断']
const SUBTYPES: Record<string, string[]> = {
  '判断推理': ['逻辑判断', '图形推理', '类比推理', '定义判断'],
  '言语理解': ['选词填空', '阅读理解', '语句排序', '语句填入'],
  '数量关系': ['数字推理', '数学运算'],
  '资料分析': ['图表分析', '文字资料'],
  '常识判断': ['政治', '经济', '法律', '科技', '历史', '地理'],
}

export default function NewErrorPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [ocrLoading, setOcrLoading]   = useState(false)
  const [showSourceMeta, setShowSourceMeta] = useState(false)
  const imgRef = React.useRef<HTMLInputElement>(null)

  async function handleOcr(file: File) {
    setOcrLoading(true)
    setError('')
    try {
      const form = new FormData(); form.append('image', file)
      const res  = await fetch('/api/ai/ocr', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? '识别失败'); return }
      if (data.content) set('content', data.content)
      if (data.answer)  set('answer', data.answer)
      if (data.type)    set('type', data.type)
      if (data.analysis) set('analysis', data.analysis)
      if (Array.isArray(data.options)) {
        data.options.forEach((opt: string, i: number) => {
          const letter = ['A','B','C','D'][i]
          if (letter) set('option'+letter, opt.replace(/^[A-D][\.、]/,'').trim())
        })
      }
    } catch (err: any) {
      setError(err.message ?? '识别失败')
    } finally {
      setOcrLoading(false)
    }
  }
  const [error, setError]           = useState('')

  const [form, setForm] = useState({
    content:     '',
    optionA:     '',
    optionB:     '',
    optionC:     '',
    optionD:     '',
    answer:      'A',
    analysis:    '',
    type:        '判断推理',
    subtype:     '',
    myAnswer:    'A',
    errorReason: '',
    examType:    'guo_kao',
    srcYear:     '',
    srcOrigin:   '',
  })

  useEffect(() => {
    fetch('/api/onboarding')
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return
        setForm(current => ({
          ...current,
          examType: data.examType || current.examType,
        }))
      })
      .catch(() => {})
  }, [])

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.content.trim()) { setError('请填写题目内容'); return }
    if (!form.optionA.trim() || !form.optionB.trim()) { setError('至少填写 A、B 两个选项'); return }

    setSubmitting(true)
    setError('')

    const options = [
      form.optionA && `A.${form.optionA}`,
      form.optionB && `B.${form.optionB}`,
      form.optionC && `C.${form.optionC}`,
      form.optionD && `D.${form.optionD}`,
    ].filter(Boolean)

    const res = await fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content:     form.content,
        options,
        answer:      form.answer,
        analysis:    form.analysis,
        type:        form.type,
        subtype:     form.subtype,
        myAnswer:    form.myAnswer,
        errorReason: form.errorReason,
        examType:    form.examType,
        srcYear:     form.srcYear,
        srcOrigin:   form.srcOrigin,
      }),
    })

    setSubmitting(false)

    if (res.ok) {
      router.push('/errors')
    } else {
      const data = await res.json()
      setError(data.error ?? '录入失败，请重试')
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
      {/* 头部 */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 min-h-[44px] min-w-[44px] flex items-center text-xl">
          ←
        </button>
        <h1 className="text-xl font-bold text-gray-900">录入错题</h1>
      </div>

      {/* B6: 截图识别 */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 mb-4 flex items-center gap-3">
        <span className="text-2xl">📸</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-blue-700">截图识别</p>
          <p className="text-xs text-blue-500">上传题目截图，AI自动填写</p>
        </div>
        <input ref={imgRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleOcr(f) }} />
        <button type="button" onClick={() => imgRef.current?.click()}
          disabled={ocrLoading}
          className="px-3 py-2 bg-blue-600 text-white text-sm rounded-xl disabled:opacity-50">
          {ocrLoading ? '识别中...' : '上传截图'}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 题型 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">题型 *</label>
          <div className="flex flex-wrap gap-2">
            {QUESTION_TYPES.map(t => (
              <button
                key={t} type="button"
                onClick={() => { set('type', t); set('subtype', '') }}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors
                  ${form.type === t
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
              >
                {t}
              </button>
            ))}
          </div>
          {SUBTYPES[form.type]?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {SUBTYPES[form.type].map(s => (
                <button
                  key={s} type="button"
                  onClick={() => set('subtype', s)}
                  className={`px-3 py-1 rounded-lg text-xs border transition-colors
                    ${form.subtype === s
                      ? 'bg-blue-100 text-blue-700 border-blue-300'
                      : 'bg-white text-gray-500 border-gray-100 hover:border-gray-200'
                    }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 题目内容 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">题目内容 *</label>
          <textarea
            value={form.content}
            onChange={e => set('content', e.target.value)}
            placeholder="粘贴或输入题目原文..."
            className="w-full h-32 px-3 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            required
          />
        </div>

        {/* 选项 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">选项 *</label>
          <div className="space-y-2">
            {['A', 'B', 'C', 'D'].map(letter => (
              <div key={letter} className="flex items-center gap-2">
                <span className="w-6 text-sm font-medium text-gray-500 flex-shrink-0">{letter}.</span>
                <input
                  type="text"
                  value={(form as any)[`option${letter}`]}
                  onChange={e => set(`option${letter}`, e.target.value)}
                  placeholder={`选项 ${letter}${letter === 'A' || letter === 'B' ? ' *' : ''}`}
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 正确答案 / 我的答案 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">正确答案 *</label>
            <select
              value={form.answer}
              onChange={e => set('answer', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {['A','B','C','D'].map(l => <option key={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">我选了 *</label>
            <select
              value={form.myAnswer}
              onChange={e => set('myAnswer', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {['A','B','C','D'].map(l => <option key={l}>{l}</option>)}
            </select>
          </div>
        </div>

        {/* 错误原因 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">我为什么错了？</label>
          <input
            type="text"
            value={form.errorReason}
            onChange={e => set('errorReason', e.target.value)}
            placeholder="简单描述，如：审题粗心 / 概念混淆..."
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        {/* 官方解析（可选） */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">官方解析（可选）</label>
          <textarea
            value={form.analysis}
            onChange={e => set('analysis', e.target.value)}
            placeholder="从答案页复制过来，AI解析时会用到..."
            className="w-full h-20 px-3 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-700">来源信息</p>
              <p className="text-xs text-gray-500 mt-1">
                默认按 {form.examType === 'guo_kao' ? '国考' : form.examType === 'sheng_kao' ? '省考' : form.examType === 'tong_kao' ? '统考' : '通用'} 保存
                {form.srcYear ? ` · ${form.srcYear}` : ''}
                {form.srcOrigin ? ` · ${form.srcOrigin}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSourceMeta(v => !v)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600"
            >
              {showSourceMeta ? '收起' : '修改'}
            </button>
          </div>
          {showSourceMeta && (
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">年份</label>
                <input
                  type="text"
                  value={form.srcYear}
                  onChange={e => set('srcYear', e.target.value)}
                  placeholder="如 2024"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">考试来源</label>
                <select
                  value={form.examType}
                  onChange={e => set('examType', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="guo_kao">国考</option>
                  <option value="sheng_kao">省考</option>
                  <option value="tong_kao">统考</option>
                  <option value="common">通用</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">来源名称</label>
                <input
                  type="text"
                  value={form.srcOrigin}
                  onChange={e => set('srcOrigin', e.target.value)}
                  placeholder="如：2024年国考行测"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-xl">{error}</div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl text-base hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? '录入中...' : '保存到错题本'}
        </button>
      </form>
    </div>
  )
}
