'use client'
// src/app/(app)/errors/batch/page.tsx
// 批量快速录题（§5.4）：做完一套真题后，10秒/题，Tab 键切换

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const QUESTION_TYPES = ['判断推理', '言语理解', '数量关系', '资料分析', '常识判断']
const OPTIONS = ['A', 'B', 'C', 'D']

interface BatchRow {
  no:          string   // 题号
  myAnswer:    string   // 我选的
  correctAnswer: string // 正确答案
  type:        string   // 题型
  note:        string   // 备注
}

function emptyRow(): BatchRow {
  return { no: '', myAnswer: 'A', correctAnswer: 'B', type: '判断推理', note: '' }
}

export default function BatchEntryPage() {
  const router  = useRouter()
  const [rows, setRows]         = useState<BatchRow[]>([emptyRow()])
  const [srcName, setSrcName]   = useState('')  // 来源，如"2024年国考"
  const [examType, setExamType] = useState('guo_kao')
  const [showMeta, setShowMeta] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]     = useState<{ done: number; skipped: number } | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[][]>([])

  // 自动添加新行：最后一行 no 有值时
  useEffect(() => {
    const last = rows[rows.length - 1]
    if (last.no.trim()) {
      setRows(r => [...r, emptyRow()])
    }
  }, [rows])

  useEffect(() => {
    fetch('/api/onboarding')
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return
        setExamType(data.examType || 'guo_kao')
      })
      .catch(() => {})
  }, [])

  function setCell(rowIdx: number, field: keyof BatchRow, value: string) {
    setRows(rows => rows.map((r, i) => i === rowIdx ? { ...r, [field]: value } : r))
  }

  // Tab 键在格子间横向移动，行末跳下一行第一格
  function handleKeyDown(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const COLS = 5  // no, myAnswer, correctAnswer, type, note
    const nextCol = colIdx + 1
    if (nextCol < COLS) {
      inputRefs.current[rowIdx]?.[nextCol]?.focus()
    } else {
      // 行末跳下一行第一格
      const nextRow = rowIdx + 1
      if (nextRow < rows.length) {
        inputRefs.current[nextRow]?.[0]?.focus()
      }
    }
  }

  // 过滤有效行（题号+我的答案+正确答案不为空，且答案不同）
  const validRows = rows.filter(r =>
    r.no.trim() && r.myAnswer && r.correctAnswer && r.myAnswer !== r.correctAnswer
  )

  async function handleSubmit() {
    if (validRows.length === 0) return
    setSubmitting(true)

    const results = await Promise.allSettled(
      validRows.map(row =>
        fetch('/api/errors', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content:     `（第${row.no}题）${srcName ? `来源：${srcName}` : ''}`,
            options:     ['A.（选项A）', 'B.（选项B）', 'C.（选项C）', 'D.（选项D）'],
            answer:      row.correctAnswer,
            type:        row.type,
            myAnswer:    row.myAnswer,
            errorReason: row.note || undefined,
            examType,
            srcOrigin:   srcName || undefined,
          }),
        })
      )
    )

    const done    = results.filter(r => r.status === 'fulfilled').length
    const skipped = results.length - done
    setResult({ done, skipped })
    setSubmitting(false)
  }

  if (result) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-16 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">录入完成</h2>
        <p className="text-gray-500 mb-1">成功录入 <span className="text-blue-600 font-bold">{result.done}</span> 道错题</p>
        {result.skipped > 0 && (
          <p className="text-sm text-gray-400">跳过 {result.skipped} 道（已存在或答案相同）</p>
        )}
        <p className="text-xs text-gray-400 mt-3">AI 正在后台生成解析，稍后可在错题本查看</p>
        <div className="flex gap-3 mt-8">
          <button onClick={() => { setRows([emptyRow()]); setResult(null) }}
            className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-2xl font-medium">
            继续录入
          </button>
          <button onClick={() => router.push('/errors')}
            className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-bold">
            查看错题本
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-32">
      {/* 头部 */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()}
          className="text-gray-400 min-h-[44px] min-w-[44px] flex items-center text-xl">←</button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">批量录题</h1>
          <p className="text-xs text-gray-400">做完整套真题后用 · Tab 键快速跳格</p>
        </div>
      </div>

      {/* 来源配置 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-800">来源信息</p>
            <p className="text-xs text-gray-400 mt-1">
              默认按 {examType === 'guo_kao' ? '国考' : examType === 'sheng_kao' ? '省考' : '统考'} 录入
              {srcName ? ` · ${srcName}` : ''}
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
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">来源名称</label>
              <input
                value={srcName}
                onChange={e => setSrcName(e.target.value)}
                placeholder="如：2024年国考行测"
                className="w-full px-3 py-2 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">考试类型</label>
              <select
                value={examType}
                onChange={e => setExamType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="guo_kao">国考</option>
                <option value="sheng_kao">省考</option>
                <option value="tong_kao">统考</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* 表头 */}
      <div className="grid grid-cols-12 gap-1 mb-1 px-1">
        {['题号', '我选', '正确', '题型', '备注'].map((h, i) => (
          <div key={h} className={`text-xs font-medium text-gray-400
            ${i === 0 ? 'col-span-1' : i === 1 ? 'col-span-1' : i === 2 ? 'col-span-1' : i === 3 ? 'col-span-4' : 'col-span-5'}`}>
            {h}
          </div>
        ))}
      </div>

      {/* 批量输入行 */}
      <div className="space-y-1.5">
        {rows.map((row, ri) => {
          if (!inputRefs.current[ri]) inputRefs.current[ri] = []
          const isError = row.no && row.myAnswer === row.correctAnswer

          return (
            <div key={ri} className={`grid grid-cols-12 gap-1 items-center
              ${isError ? 'opacity-40' : ''}`}>

              {/* 题号 */}
              <input
                ref={el => { if (inputRefs.current[ri]) inputRefs.current[ri][0] = el }}
                value={row.no}
                onChange={e => setCell(ri, 'no', e.target.value)}
                onKeyDown={e => handleKeyDown(e, ri, 0)}
                placeholder={String(ri + 1)}
                className="col-span-1 px-2 py-2.5 border border-gray-100 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />

              {/* 我选 */}
              <select
                ref={el => { if (inputRefs.current[ri]) inputRefs.current[ri][1] = el as any }}
                value={row.myAnswer}
                onChange={e => setCell(ri, 'myAnswer', e.target.value)}
                onKeyDown={e => handleKeyDown(e, ri, 1)}
                className="col-span-1 px-1 py-2.5 border border-gray-100 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                {OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>

              {/* 正确 */}
              <select
                ref={el => { if (inputRefs.current[ri]) inputRefs.current[ri][2] = el as any }}
                value={row.correctAnswer}
                onChange={e => setCell(ri, 'correctAnswer', e.target.value)}
                onKeyDown={e => handleKeyDown(e, ri, 2)}
                className="col-span-1 px-1 py-2.5 border border-green-100 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-400 bg-green-50 text-green-700"
              >
                {OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>

              {/* 题型 */}
              <select
                ref={el => { if (inputRefs.current[ri]) inputRefs.current[ri][3] = el as any }}
                value={row.type}
                onChange={e => setCell(ri, 'type', e.target.value)}
                onKeyDown={e => handleKeyDown(e, ri, 3)}
                className="col-span-4 px-2 py-2.5 border border-gray-100 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                {QUESTION_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>

              {/* 备注 */}
              <input
                ref={el => { if (inputRefs.current[ri]) inputRefs.current[ri][4] = el }}
                value={row.note}
                onChange={e => setCell(ri, 'note', e.target.value)}
                onKeyDown={e => handleKeyDown(e, ri, 4)}
                placeholder="可选"
                className="col-span-5 px-2 py-2.5 border border-gray-100 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 mt-3 text-center">
        {validRows.length > 0
          ? `已填 ${validRows.length} 道有效错题（答案不同的行）`
          : '答案与正确答案相同的行会自动跳过'}
      </p>

      {/* 底部提交 */}
      <div className="fixed bottom-20 left-4 right-4 max-w-2xl mx-auto">
        <button
          onClick={handleSubmit}
          disabled={submitting || validRows.length === 0}
          className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl text-base hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-lg"
        >
          {submitting
            ? `录入中...`
            : validRows.length > 0
              ? `保存 ${validRows.length} 道错题`
              : '填写题号和答案后提交'}
        </button>
      </div>
    </div>
  )
}
