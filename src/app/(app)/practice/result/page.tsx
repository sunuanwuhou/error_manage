'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function readNumber(value: string | null, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export default function PracticeResultPage() {
  const searchParams = useSearchParams()

  const answered = readNumber(searchParams.get('answered'))
  const correct = readNumber(searchParams.get('correct'))
  const wrong = readNumber(searchParams.get('wrong'))
  const accuracy = readNumber(searchParams.get('accuracy'))
  const weakType = searchParams.get('weakType') || ''
  const paperKey = searchParams.get('paperKey') || ''
  const questionId = searchParams.get('questionId') || ''

  const suggestion = !wrong
    ? '本轮没有错题，建议直接提高题量，或切换到更高难度 / 更薄弱模块。'
    : weakType
      ? `本轮主要薄弱点集中在“${weakType}”，建议先回看，再到错题本按该题型复训。`
      : '建议先回看本轮，再到错题本做二次训练。'

  const restartHref = questionId
    ? `/practice?questionId=${questionId}`
    : `/practice${paperKey ? `?paperKey=${encodeURIComponent(paperKey)}` : ''}`

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">练习结果</h1>

      <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">已作答</p>
            <p className="mt-1 text-2xl font-semibold">{answered}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">答对</p>
            <p className="mt-1 text-2xl font-semibold">{correct}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">答错</p>
            <p className="mt-1 text-2xl font-semibold">{wrong}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">正确率</p>
            <p className="mt-1 text-2xl font-semibold">{accuracy}%</p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border bg-amber-50 p-4 text-sm">
          <p className="font-medium">下一步训练建议</p>
          <p className="mt-2 text-slate-700">{suggestion}</p>
          <p className="mt-2 text-slate-700">默认建议路径：先进入本轮复盘，再按待处理顺序补笔记 / 挂知识点 / 清待复习。</p>
          {weakType ? <p className="mt-2 text-slate-700">主要薄弱题型：{weakType}</p> : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/wrong-questions/workbench/review" className="rounded-xl bg-black px-4 py-2 text-white">开始本轮复盘</Link>
          <Link href="/wrong-questions/workbench" className="rounded-xl border px-4 py-2">去错题工作台</Link>
          <Link href="/wrong-questions" className="rounded-xl border px-4 py-2">旧错题页</Link>
          <Link href={restartHref} className="rounded-xl border px-4 py-2">重新开始</Link>
          <Link href="/practice" className="rounded-xl bg-black px-4 py-2 text-white">返回练习页</Link>
        </div>
      </section>
    </main>
  )
}
