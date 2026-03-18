'use client'
// src/app/(app)/practice/page.tsx — 答题页（完整版）
// A5: 静默计时 + isSlowCorrect 自动计算
// O2: 答题页计时器显示（右上角，超警戒线变红）
// O4: 揭晓后展示 AI 行动规则
// O7: 记住上次练习模式

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CorrectionCard } from '@/components/practice/correction-card'
import { StateBadge } from '@/components/practice/state-badge'
import { getQuestionState, SPEED_LIMITS } from '@/lib/mastery-engine'
import { useTimer, formatTime } from '@/lib/use-timer'

type PracticeMode = 'quick' | 'deep'
type Step = 'mode_select' | 'answering' | 'thinking' | 'revealed' | 'done'
type ThinkingVerdict = 'correct' | 'partial' | 'wrong'

interface QueueItem {
  userErrorId:   string | null
  questionId:    string
  source:        'error' | 'practice'
  masteryPercent: number
  reviewCount:   number
  questionType:  string
  isHot:         boolean
  question: {
    id:       string
    content:  string
    options:  string
    answer:   string
    type:     string
    subtype?: string
    analysis?: string
    sharedAiAnalysis?: string
    skillTags?: string
  }
  aiActionRule?: string
  aiThinking?:   string
}

interface SubmitResult {
  masteryPercent:   number
  reviewInterval:   number
  isStockified:     boolean
  resultMatrix:     string
  wasStockifiedNow: boolean
  preStockified:    boolean
  isHot:            boolean
  reboundAlert:     boolean
}

const MODE_KEY = 'pref_practice_mode'

function parseOptions(raw: string | undefined): string[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

function getResultLabel(matrix: string) {
  return { '1': '⬆️ 升级', '2': '➡️ 维持', '3': '➡️ 维持', '4': '⬇️ 降级' }[matrix] ?? ''
}

export default function PracticePage() {
  const router = useRouter()

  // O7: 记住上次模式
  const savedMode = (typeof window !== 'undefined' ? localStorage.getItem(MODE_KEY) : null) as PracticeMode | null

  const [step, setStep]         = useState<Step>('mode_select')
  const [mode, setMode]         = useState<PracticeMode>(savedMode ?? 'deep')
  const [queue, setQueue]       = useState<QueueItem[]>([])
  const [idx, setIdx]           = useState(0)
  const [loading, setLoading]   = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [thinking, setThinking] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verdict, setVerdict]   = useState<ThinkingVerdict | null>(null)
  const [verdictFeedback, setVerdictFeedback] = useState('')
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)
  const [sessionStats, setSessionStats] = useState({ done: 0, stockifiedNow: 0 })
  const [diagnosing, setDiagnosing] = useState(false)
  const [customAnalysis, setCustomAnalysis] = useState('')
  const sessionStartRef = useRef<string>(new Date().toISOString())

  const current  = queue[idx]
  const options  = parseOptions(current?.question?.options)
  const isLast   = idx >= queue.length - 1

  // A5: 计时器
  const timer = useTimer(current?.question?.type ?? '判断推理')

  useEffect(() => {
    fetch('/api/daily-tasks')
      .then(r => r.json())
      .then(async data => {
        const errorIds    = data.reviewErrors?.map((e: any) => e.userErrorId) ?? []
        const questionIds = data.practiceQuestions ?? []

        // F1: 分别用 ids（错题）和 qids（真题）查询
        const params = new URLSearchParams()
        if (errorIds.length)    params.set('ids',  errorIds.join(','))
        if (questionIds.length) params.set('qids', questionIds.join(','))

        if (!errorIds.length && !questionIds.length) { setQueue([]); return }

        const res   = await fetch(`/api/errors/queue?${params}`)
        const items = await res.json()
        setQueue(items)
      })
  }, [])

  // 每次切到新题开始计时
  useEffect(() => {
    if (step === 'answering') timer.start()
  }, [step, idx])

  function handleSelectMode(m: PracticeMode) {
    setMode(m)
    localStorage.setItem(MODE_KEY, m)  // O7
    setStep('answering')
  }

  function handleSelect(opt: string) {
    if (step !== 'answering') return
    setSelected(opt.charAt(0))
    if (mode === 'quick') {
      const timeSpent = timer.stop()
      handleReveal(opt.charAt(0), null, timeSpent)
    } else {
      setStep('thinking')
    }
  }

  async function handleVerifyThinking() {
    if (!thinking.trim() || !current) return
    setVerifying(true)
    try {
      const res  = await fetch('/api/ai/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:            'verify_thinking',
          questionContent: current.question.content,
          correctAnswer:   current.question.answer,
          userThinking:    thinking,
          sharedAnalysis:  current.question.sharedAiAnalysis,
        }),
      })
      const data = await res.json()
      setVerdict(data.verdict)
      setVerdictFeedback(data.feedback ?? '')
    } catch {
      setVerdict('partial'); setVerdictFeedback('AI 验证暂时不可用')
    } finally { setVerifying(false) }
  }

  const handleReveal = useCallback(async (answer: string | null, tv: ThinkingVerdict | null, timeSpent: number) => {
    if (!current) return
    setLoading(true)
    const sel = answer ?? selected
    if (!sel) { setLoading(false); return }

    const isCorrect = sel === current.question.answer
    const limit     = SPEED_LIMITS[current.question.type] ?? 90
    const isSlowCorrect = isCorrect && timeSpent > limit  // A5

    try {
      // F2: 区分错题和真题提交
      const submitBody: any = {
        isCorrect, timeSpent, isSlowCorrect,
        thinkingVerdict:  tv,
        thinkingFeedback: verdictFeedback,
        userThinkingText: thinking,
        thinkingInputType: mode === 'deep' ? 'text' : null,
        practiceMode:     mode,
        selectedAnswer:   sel,
      }
      if (current.source === 'practice') {
        submitBody.source     = 'practice'
        submitBody.questionId = current.questionId
      } else {
        submitBody.source      = 'error'
        submitBody.userErrorId = current.userErrorId
      }

      const res  = await fetch('/api/review/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitBody),
      })
      const result: SubmitResult = await res.json()
      setSubmitResult(result)
      setSessionStats(s => ({
        done:          s.done + 1,
        stockifiedNow: s.stockifiedNow + (result.wasStockifiedNow ? 1 : 0),
      }))
    } catch {}
    setStep('revealed')
    setLoading(false)
  }, [current, selected, thinking, verdictFeedback, mode])

  function handleDeepReveal() {
    const timeSpent = timer.stop()
    handleReveal(selected, verdict, timeSpent)
  }

  function handleNext() {
    if (isLast) {
      router.push('/practice/summary?since=' + encodeURIComponent(sessionStartRef.current))
      return
    }
    setIdx(i => i + 1)
    setSelected(null); setThinking(''); setVerdict(null); setCustomAnalysis('')
    setVerdictFeedback(''); setSubmitResult(null)
    setStep('answering')
  }

  // ── 模式选择 ────────────────────────────────────────────
  if (step === 'mode_select') {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8">
        <h2 className="text-xl font-bold text-gray-900 mb-2">选择练习模式</h2>
        <p className="text-sm text-gray-500 mb-6">今日共 {queue.length} 道题</p>
        <div className="space-y-3">
          {[
            { mode: 'deep'  as const, icon: '🎯', label: '深度练习模式', tag: '推荐',
              desc: '先选答案 → 写思路 → AI验证 → 揭晓', hint: '每题 5-10 分钟 · 修正思维链' },
            { mode: 'quick' as const, icon: '⚡', label: '快速复习模式', tag: '',
              desc: '直接选答案揭晓，适合疲惫时快速过', hint: '每题 1-2 分钟' },
          ].map(m => (
            <button key={m.mode} onClick={() => handleSelectMode(m.mode)}
              className={`w-full text-left rounded-2xl p-5 border-2 transition-colors hover:bg-blue-50
                ${mode === m.mode ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white'}`}>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">{m.icon}</span>
                <span className="font-bold text-gray-900">{m.label}</span>
                {m.tag && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{m.tag}</span>}
              </div>
              <p className="text-sm text-gray-500">{m.desc}</p>
              <p className="text-xs text-gray-400 mt-0.5">{m.hint}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (!current) return (
    <div className="max-w-lg mx-auto px-4 pt-16 text-center text-gray-400">
      <p className="text-4xl mb-3">📭</p><p>今日没有待复习的题目</p>
      <button onClick={() => router.push('/errors/new')} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-xl text-sm">去录题</button>
    </div>
  )

  const state = getQuestionState({ masteryPercent: current.masteryPercent, isStockified: false, daysToExam: null })

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
      {/* 进度条 + O2: 计时器 */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.push('/dashboard')} className="text-gray-400 min-h-[44px] min-w-[44px] flex items-center">←</button>
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(idx / queue.length) * 100}%` }} />
        </div>
        <span className="text-sm text-gray-400 tabular-nums">{idx + 1}/{queue.length}</span>
        {/* O2: 计时器 */}
        {step === 'answering' || step === 'thinking' ? (
          <span className={`text-sm tabular-nums font-mono min-w-[36px] text-right transition-colors
            ${timer.isOverLimit ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
            {formatTime(timer.elapsed)}
          </span>
        ) : null}
      </div>

      {/* 题型 + 状态 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
          {current.question.type}{current.question.subtype ? ` · ${current.question.subtype}` : ''}
        </span>
        <StateBadge state={state} masteryPercent={current.masteryPercent} isHot={current.isHot} />
      </div>

      {/* 题目 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <p className="text-base text-gray-900 leading-relaxed whitespace-pre-wrap">{current.question.content}</p>
      </div>

      {/* 修正卡 */}
      {mode === 'deep' && step === 'answering' && (current.aiActionRule || current.question.sharedAiAnalysis) && (
        <div className="mb-4">
          <CorrectionCard
            skillTag={current.question.type}
            aiActionRule={current.aiActionRule}
            aiThinking={current.aiThinking}
            sharedAiAnalysis={current.question.sharedAiAnalysis}
            reviewCount={current.reviewCount}
          />
        </div>
      )}

      {/* 选项（答题中） */}
      {(step === 'answering' || step === 'thinking') && (
        <div className="space-y-2 mb-4">
          {options.map(opt => {
            const letter = opt.charAt(0)
            const isSel  = selected === letter
            return (
              <button key={opt} onClick={() => handleSelect(opt)} disabled={step === 'thinking'}
                className={`w-full text-left px-4 py-3.5 rounded-xl border-2 transition-all text-sm min-h-[44px]
                  ${isSel ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                          : 'border-gray-100 bg-white text-gray-700 hover:border-gray-300'}
                  ${step === 'thinking' ? 'cursor-default' : 'active:scale-[0.98]'}`}>
                {opt}
              </button>
            )
          })}
        </div>
      )}

      {/* 选项（揭晓后） */}
      {step === 'revealed' && (
        <div className="space-y-2 mb-4">
          {options.map(opt => {
            const letter = opt.charAt(0)
            const isRight = letter === current.question.answer
            const isWrong = letter === selected && !isRight
            return (
              <div key={opt} className={`w-full text-left px-4 py-3.5 rounded-xl border-2 text-sm
                ${isRight ? 'border-green-500 bg-green-50 text-green-900 font-medium'
                : isWrong ? 'border-red-400 bg-red-50 text-red-700'
                : 'border-gray-100 bg-white text-gray-400'}`}>
                {opt}
                {isRight && <span className="ml-2 text-green-600">✓ 正确答案</span>}
                {isWrong  && <span className="ml-2 text-red-500">✗ 我的选择</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* 深度模式思路框 */}
      {mode === 'deep' && step === 'thinking' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-2">写下你的解题思路</p>
          <textarea value={thinking} onChange={e => setThinking(e.target.value)}
            placeholder="你是怎么想到选这个答案的？写关键步骤即可..."
            className="w-full h-28 text-sm text-gray-700 border border-gray-100 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <div className="flex gap-2 mt-3">
            {thinking.trim() && (
              <button onClick={handleVerifyThinking} disabled={verifying}
                className="flex-1 py-2.5 border border-blue-500 text-blue-600 rounded-xl text-sm font-medium hover:bg-blue-50 disabled:opacity-50">
                {verifying ? 'AI 验证中...' : 'AI 验证思路'}
              </button>
            )}
            <button onClick={handleDeepReveal} disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? '提交中...' : '揭晓答案'}
            </button>
          </div>
          {verdict && (
            <div className={`mt-3 rounded-xl p-3 text-sm border
              ${verdict === 'correct' ? 'bg-green-50 text-green-700 border-green-200'
              : verdict === 'partial' ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-red-50 text-red-700 border-red-200'}`}>
              <span className="font-medium">
                {verdict === 'correct' ? '✅ 思路正确' : verdict === 'partial' ? '⚠️ 部分正确' : '❌ 有偏差'}
              </span>
              {verdictFeedback && <p className="mt-1 text-xs opacity-80">{verdictFeedback}</p>}
            </div>
          )}
        </div>
      )}

      {/* 揭晓后反馈 */}
      {step === 'revealed' && (
        <div className="space-y-3 mb-4">
          {submitResult && (
            <div className={`rounded-xl p-3 text-sm border
              ${submitResult.resultMatrix === '1' ? 'bg-green-50 border-green-200 text-green-700'
              : submitResult.resultMatrix === '4' ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{getResultLabel(submitResult.resultMatrix)}</span>
                <span className="tabular-nums">掌握度 {submitResult.masteryPercent}%</span>
              </div>
              {submitResult.wasStockifiedNow && (
                <p className="mt-1 text-green-600 font-medium">🎉 这道题已存量化！</p>
              )}
              {(submitResult as any).addedToErrorBook && (
                <p className="mt-1 text-blue-600 text-xs">📕 已自动加入错题本，下次按遗忘曲线复习</p>
              )}
              {/* A4: 预存量化🌱 */}
              {submitResult.preStockified && !submitResult.wasStockifiedNow && (
                <p className="mt-1 text-emerald-600 text-xs">🌱 预稳固！再复习1-2次就能存量化</p>
              )}
              {submitResult.isHot && !submitResult.wasStockifiedNow && (
                <p className="mt-1 text-red-500 text-xs">🔥 已连续出错，下次深度模式重点练</p>
              )}
            </div>
          )}

          {/* O4: AI 行动规则展示 */}
          {current.aiActionRule && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-xs text-blue-500 font-medium mb-1">📌 下次遇到类似题</p>
              <p className="text-sm text-blue-800 font-medium">{current.aiActionRule}</p>
            </div>
          )}

          {/* B7: 个性化AI诊断按钮 */}
          {!customAnalysis ? (
            <button onClick={async () => {
              setDiagnosing(true)
              try {
                const res = await fetch(`/api/errors/${current.userErrorId}/diagnose`, { method: 'POST' })
                const d   = await res.json()
                if (d.analysis) setCustomAnalysis(d.analysis)
              } finally { setDiagnosing(false) }
            }} disabled={diagnosing}
              className="w-full py-2.5 border border-purple-200 text-purple-600 rounded-xl text-sm font-medium hover:bg-purple-50 disabled:opacity-50">
              {diagnosing ? '🤖 深度诊断中...' : '🔬 个性化深度诊断'}
            </button>
          ) : (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
              <p className="text-xs text-purple-500 font-medium mb-1">🔬 个性化诊断</p>
              <p className="text-sm text-purple-800 whitespace-pre-wrap leading-relaxed">{customAnalysis}</p>
            </div>
          )}

          {(current.question.analysis || current.question.sharedAiAnalysis) && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs font-medium text-gray-500 mb-2">解析</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {current.question.sharedAiAnalysis || current.question.analysis}
              </p>
            </div>
          )}
        </div>
      )}

      {/* B7: 个性化AI诊断按钮（答错时显示）*/}
      {step === 'revealed' && mode === 'deep' && selected !== current?.question?.answer && (
        <CustomDiagnosisButton
          questionContent={current.question.content}
          correctAnswer={current.question.answer}
          myAnswer={selected ?? ''}
        />
      )}

      {step === 'revealed' && (
        <button onClick={handleNext}
          className="fixed bottom-20 left-4 right-4 max-w-[calc(512px-2rem)] mx-auto py-4 bg-blue-600 text-white font-bold rounded-2xl text-base hover:bg-blue-700 transition-colors">
          {isLast ? '查看今日总结 →' : '下一题 →'}
        </button>
      )}
    </div>
  )
}

// B7: 个性化AI诊断组件
function CustomDiagnosisButton({ questionContent, correctAnswer, myAnswer }: {
  questionContent: string; correctAnswer: string; myAnswer: string
}) {
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<any>(null)
  const [expanded, setExpanded] = useState(false)

  async function handleDiagnose() {
    setLoading(true)
    const res = await fetch('/api/ai/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'first_diagnosis', questionContent, correctAnswer, myAnswer }),
    })
    const data = await res.json()
    setResult(data); setExpanded(true); setLoading(false)
  }

  if (!result) {
    return (
      <div className="mb-3">
        <button onClick={handleDiagnose} disabled={loading}
          className="w-full py-2.5 border border-purple-200 text-purple-600 text-sm rounded-xl hover:bg-purple-50 disabled:opacity-50 transition-colors">
          {loading ? '✨ AI 深度分析中...' : '✨ 让 AI 深度分析这道题的错因'}
        </button>
      </div>
    )
  }

  return (
    <div className="mb-3 bg-purple-50 border border-purple-200 rounded-2xl p-4">
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between">
        <span className="text-sm font-semibold text-purple-700">✨ AI 深度诊断</span>
        <span className="text-purple-400">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          {result.aiRootReason && <p><span className="text-purple-500 font-medium">根本原因：</span>{result.aiRootReason}</p>}
          {result.aiActionRule && <p className="bg-white rounded-lg p-2 text-purple-800 font-medium">📌 {result.aiActionRule}</p>}
          {result.aiThinking && <p className="text-gray-600 text-xs leading-relaxed">{result.aiThinking}</p>}
        </div>
      )}
    </div>
  )
}

