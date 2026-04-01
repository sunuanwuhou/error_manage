'use client'

import { useMemo, useState } from 'react'

export default function WrongQuestionsManualEntryPage() {
  const [content, setContent] = useState('')
  const [questionType, setQuestionType] = useState('单项选择题')
  const [userAnswer, setUserAnswer] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [errorReason, setErrorReason] = useState('')
  const [noteHint, setNoteHint] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  const payload = useMemo(() => ({
    source: 'manual_entry',
    content,
    questionType,
    userAnswer,
    correctAnswer,
    errorReason,
    noteHint,
  }), [content, questionType, userAnswer, correctAnswer, errorReason, noteHint])

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">手动录入错题</h1>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid gap-4">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={8}
            placeholder="题干 / 题目原文"
            className="rounded-xl border px-3 py-2"
          />

          <div className="grid gap-3 md:grid-cols-3">
            <select value={questionType} onChange={e => setQuestionType(e.target.value)} className="rounded-xl border px-3 py-2">
              <option value="单项选择题">单项选择题</option>
              <option value="判断推理">判断推理</option>
              <option value="言语理解">言语理解</option>
              <option value="资料分析">资料分析</option>
              <option value="未分类">未分类</option>
            </select>
            <input value={userAnswer} onChange={e => setUserAnswer(e.target.value)} placeholder="我的答案" className="rounded-xl border px-3 py-2" />
            <input value={correctAnswer} onChange={e => setCorrectAnswer(e.target.value)} placeholder="正确答案" className="rounded-xl border px-3 py-2" />
          </div>

          <textarea
            value={errorReason}
            onChange={e => setErrorReason(e.target.value)}
            rows={4}
            placeholder="错因（例：审题错误 / 知识点不清 / 计算粗心）"
            className="rounded-xl border px-3 py-2"
          />

          <textarea
            value={noteHint}
            onChange={e => setNoteHint(e.target.value)}
            rows={4}
            placeholder="笔记提示（你准备怎么记、准备挂到哪个知识点）"
            className="rounded-xl border px-3 py-2"
          />

          <div className="flex flex-wrap gap-3">
            <button onClick={() => setPreviewOpen(prev => !prev)} className="rounded-xl border px-4 py-2">
              {previewOpen ? '收起预览' : '预览录入结构'}
            </button>
          </div>

          {previewOpen ? (
            <pre className="overflow-auto rounded-xl bg-slate-50 p-4 text-sm">{JSON.stringify(payload, null, 2)}</pre>
          ) : null}

          <div className="rounded-xl border bg-amber-50 p-4 text-sm">
            <p className="font-medium">当前阶段说明</p>
            <p className="mt-2 text-slate-700">
              这里先建立“手动录入错题”正式入口，后续会继续和 `error_analysis` 的错题工作台正式数据流并线。也就是说，手动录入和刷题后自动沉淀最终会进入同一个错题工作台。
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
