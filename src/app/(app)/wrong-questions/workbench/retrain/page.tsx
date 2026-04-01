'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type ReviewTaskItem = {
  reviewTaskId: string
  questionId: string
  priority: number
  trainingMode?: string
  taskType?: string
  createdAt: string
  analysis?: {
    errorTypePrimary?: string
    rootCause?: string
    nextAction?: string
    wrongStepIndex?: number
    wrongStepText?: string
  } | null
}

type ComparePayload = {
  standardSteps: Array<{ index: number; text: string }>
  userSteps: Array<{ index: number; text: string }>
  divergenceStepIndex: number | null
  divergenceReason: string
  replayFocusRange: { start: number; end: number } | null
  standardSummary: string
  answerCompare: { userAnswer: string; correctAnswer: string; isCorrect: boolean }
}

export default function WrongQuestionRetrainPage() {
  const searchParams = useSearchParams()
  const initialQuestionId = searchParams.get('questionId') || ''
  const [tasks, setTasks] = useState<ReviewTaskItem[]>([])
  const [selectedQuestionId, setSelectedQuestionId] = useState('')
  const [compare, setCompare] = useState<ComparePayload | null>(null)
  const [question, setQuestion] = useState<any>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [updatingTaskId, setUpdatingTaskId] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/review-tasks?status=pending').then(res => res.json()),
    ]).then(([taskData]) => {
      const nextTasks = taskData.items || []
      setTasks(nextTasks)
      const firstQuestionId = initialQuestionId || nextTasks[0]?.questionId || ''
      if (firstQuestionId) setSelectedQuestionId(firstQuestionId)
    }).finally(() => setLoading(false))
  }, [initialQuestionId])

  useEffect(() => {
    if (!selectedQuestionId) return
    fetch(`/api/process-compare?questionId=${encodeURIComponent(selectedQuestionId)}`)
      .then(res => res.json())
      .then(data => {
        setCompare(data.item || null)
        setQuestion(data.question || null)
        setAnalysis(data.analysis || null)
      })
      .catch(() => {
        setCompare(null)
        setQuestion(null)
        setAnalysis(null)
      })
  }, [selectedQuestionId])

  const currentTask = useMemo(() => tasks.find(item => item.questionId === selectedQuestionId) || null, [tasks, selectedQuestionId])


  async function updateTaskStatus(reviewTaskId: string, status: 'in_progress' | 'completed' | 'ignored') {
    setUpdatingTaskId(reviewTaskId)
    const res = await fetch(`/api/review-tasks/${reviewTaskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const data = await res.json().catch(() => ({}))
    setUpdatingTaskId('')
    if (!res.ok) {
      alert(data.error || '更新复盘任务失败')
      return
    }
    setTasks(prev => prev.map(item => item.reviewTaskId === reviewTaskId ? { ...item } : item).filter(item => item.reviewTaskId !== reviewTaskId || status === 'in_progress'))
    if (status !== 'in_progress') {
      const remain = tasks.filter(item => item.reviewTaskId !== reviewTaskId)
      const nextQuestionId = remain[0]?.questionId || ''
      setSelectedQuestionId(prev => prev === currentTask?.questionId ? nextQuestionId : prev)
    }
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-2xl font-semibold">局部重做训练</h1>
      <p className="mt-2 text-sm text-slate-500">先看系统定位的偏离步，再看标准路径，然后回原题重做。</p>

      <section className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">待处理复盘任务</h2>
            <span className="text-sm text-slate-500">{tasks.length} 条</span>
          </div>
          <div className="mt-4 grid gap-3">
            {loading ? <p className="text-sm text-slate-500">加载中...</p> : null}
            {!loading && !tasks.length ? <p className="text-sm text-slate-500">当前没有 pending 复盘任务。</p> : null}
            {tasks.map(item => {
              const active = item.questionId === selectedQuestionId
              return (
                <button key={item.reviewTaskId} onClick={() => setSelectedQuestionId(item.questionId)} className={`rounded-xl border p-3 text-left ${active ? 'border-black bg-slate-50' : 'border-slate-200'}`}>
                  <p className="text-sm font-medium">questionId：{item.questionId}</p>
                  <p className="mt-1 text-xs text-slate-500">优先级 {item.priority} · {item.trainingMode || item.taskType || '-'}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.analysis?.errorTypePrimary || '待分析'}</p>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          {!selectedQuestionId ? <p className="text-sm text-slate-500">请选择一条复盘任务。</p> : (
            <>
              <div className="flex flex-wrap gap-3">
                <Link href={`/practice?questionId=${selectedQuestionId}`} className="rounded-xl bg-black px-4 py-2 text-sm text-white">回原题重做</Link>
                <Link href={`/wrong-questions/workbench/process?questionId=${selectedQuestionId}`} className="rounded-xl border px-4 py-2 text-sm">看过程回放</Link>
                <Link href={`/wrong-questions/workbench/knowledge-link?wrongId=${selectedQuestionId}&questionId=${selectedQuestionId}`} className="rounded-xl border px-4 py-2 text-sm">挂接知识点</Link>
                {currentTask ? <button onClick={() => updateTaskStatus(currentTask.reviewTaskId, 'in_progress')} disabled={updatingTaskId === currentTask.reviewTaskId} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">标记进行中</button> : null}
                {currentTask ? <button onClick={() => updateTaskStatus(currentTask.reviewTaskId, 'completed')} disabled={updatingTaskId === currentTask.reviewTaskId} className="rounded-xl border px-4 py-2 text-sm text-green-700 disabled:opacity-50">标记已完成</button> : null}
                {currentTask ? <button onClick={() => updateTaskStatus(currentTask.reviewTaskId, 'ignored')} disabled={updatingTaskId === currentTask.reviewTaskId} className="rounded-xl border px-4 py-2 text-sm text-slate-500 disabled:opacity-50">暂时忽略</button> : null}
              </div>

              {question ? <section className="mt-6 rounded-2xl border bg-slate-50 p-5">
                <h2 className="text-lg font-medium">题目内容</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{question.content || '暂无题干'}</p>
              </section> : null}

              {(analysis || currentTask?.analysis) ? <section className="mt-6 rounded-2xl border bg-amber-50 p-5 text-sm">
                <p><span className="font-medium">系统错因：</span>{analysis?.errorTypePrimary || currentTask?.analysis?.errorTypePrimary || '-'}</p>
                <p className="mt-2"><span className="font-medium">根因：</span>{analysis?.rootCause || currentTask?.analysis?.rootCause || '-'}</p>
                <p className="mt-2"><span className="font-medium">下一步：</span>{analysis?.nextAction || currentTask?.analysis?.nextAction || '-'}</p>
                {(analysis?.wrongStepIndex || currentTask?.analysis?.wrongStepIndex) ? <p className="mt-2"><span className="font-medium">疑似偏离步：</span>第 {analysis?.wrongStepIndex || currentTask?.analysis?.wrongStepIndex} 步</p> : null}
              </section> : null}

              {compare ? <section className="mt-6 grid gap-6 xl:grid-cols-2">
                <div className="rounded-2xl border p-5">
                  <h3 className="text-lg font-medium">你的过程</h3>
                  <div className="mt-4 grid gap-3 text-sm">
                    {compare.userSteps.length ? compare.userSteps.map(step => {
                      const active = step.index === compare.divergenceStepIndex
                      return <div key={step.index} className={`rounded-xl border p-3 ${active ? 'border-amber-500 bg-amber-50' : 'border-slate-200'}`}>
                        <p className="font-medium">第 {step.index} 步</p>
                        <p className="mt-2 whitespace-pre-wrap">{step.text}</p>
                      </div>
                    }) : <p className="text-slate-500">当前没有结构化过程步骤。</p>}
                  </div>
                </div>
                <div className="rounded-2xl border p-5">
                  <h3 className="text-lg font-medium">标准路径</h3>
                  <div className="mt-4 grid gap-3 text-sm">
                    {compare.standardSteps.length ? compare.standardSteps.map(step => {
                      const active = step.index === compare.divergenceStepIndex
                      return <div key={step.index} className={`rounded-xl border p-3 ${active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                        <p className="font-medium">第 {step.index} 步</p>
                        <p className="mt-2 whitespace-pre-wrap">{step.text}</p>
                      </div>
                    }) : <p className="text-slate-500">题目解析还没拆成标准步骤。</p>}
                  </div>
                </div>
              </section> : null}

              {compare ? <section className="mt-6 rounded-2xl border bg-white p-5 text-sm">
                <p><span className="font-medium">分歧点：</span>{compare.divergenceStepIndex ? `第 ${compare.divergenceStepIndex} 步` : '暂未定位'}</p>
                <p className="mt-2"><span className="font-medium">系统判断：</span>{compare.divergenceReason}</p>
                <p className="mt-2"><span className="font-medium">答案对照：</span>你的答案 {compare.answerCompare.userAnswer || '空'} / 标准答案 {compare.answerCompare.correctAnswer || '空'}</p>
              </section> : null}
            </>
          )}
        </section>
      </section>
    </main>
  )
}
