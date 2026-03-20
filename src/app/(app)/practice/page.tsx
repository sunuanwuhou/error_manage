'use client'
// src/app/(app)/practice/page.tsx — 答题页（完整版）
// A5: 静默计时 + isSlowCorrect 自动计算
// O2: 答题页计时器显示（右上角，超警戒线变红）
// O4: 揭晓后展示 AI 行动规则
// O7: 记住上次练习模式

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CorrectionCard } from '@/components/practice/correction-card'
import { StateBadge } from '@/components/practice/state-badge'
import { getQuestionState, SPEED_LIMITS } from '@/lib/mastery-engine'
import { buildPaperModuleGroups, buildPaperModuleLabel, smoothPaperModuleLabels } from '@/lib/paper-modules'
import { useTimer, formatTime } from '@/lib/use-timer'

type PracticeMode = 'quick' | 'deep'
type Step = 'paper_intro' | 'paper_submit' | 'mode_select' | 'answering' | 'thinking' | 'revealed' | 'done'
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
    questionImage?: string | null
    options:  string
    answer:   string
    type:     string
    subtype?: string
    sub2?: string
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
  addedToErrorBook?: boolean
}

const MODE_KEY = 'pref_practice_mode'

interface PaperAnswerState {
  selected: string
  submitResult: SubmitResult | null
  timeSpentSeconds: number
}

interface RegularAnswerState {
  selected: string
  submitResult: SubmitResult | null
  customAnalysis?: string
}

interface PaperSessionRecord {
  id: string
  paperKey: string
  paperTitle: string | null
  paperYear: string | null
  paperProvince: string | null
  paperExamType: string | null
  totalQuestions: number
  activitySessionId: string
  currentIndex: number
  step: 'paper_intro' | 'answering' | 'thinking' | 'revealed' | 'paper_submit' | 'done'
  status: 'active' | 'completed' | 'abandoned'
  answered: number[]
  marked: number[]
  answers: Record<string, PaperAnswerState>
  startedAt: string
  lastAccessedAt: string
  completedAt: string | null
}

function parseOptions(raw: string | undefined): string[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

function formatQuestionContent(content: string, hasImage: boolean) {
  if (!content) return ''
  const next = hasImage
    ? content.replace(/(\[图\]|@t\d+)/gi, '').trim()
    : content.replace(/@t\d+/gi, '[图]')
  const fixed = next.replace(
    /每个办事窗口办理每笔业务的用时缩短到以前的$/g,
    '每个办事窗口办理每笔业务的用时缩短到以前的2/3'
  ).replace(
    /每个办事窗口办理每笔业务的用时缩短到以前的\[图\]/gi,
    '每个办事窗口办理每笔业务的用时缩短到以前的2/3'
  )
  return fixed || (hasImage ? '请结合上方图片作答。' : content)
}

function formatOptionLabel(option: string, hasQuestionImage: boolean) {
  if (!option) return ''
  const normalized = option
    .replace(/^([A-D])\.\1$/, '$1.见图')
    .replace(/@t\d+/gi, hasQuestionImage ? '见图' : '[图]')
    .replace(/\[图[A-D]?\]/g, hasQuestionImage ? '见图' : '[图]')
  return normalized
}

function getMediaLabel(questionType: string, hasImage: boolean) {
  if (!hasImage) return ''
  return questionType === '资料分析' ? '资料 / 材料图' : '题目图片'
}

function getResultLabel(matrix: string) {
  return { '1': '⬆️ 升级', '2': '➡️ 维持', '3': '➡️ 维持', '4': '⬇️ 降级' }[matrix] ?? ''
}

function formatAvgSeconds(totalSeconds: number, answeredCount: number) {
  if (!answeredCount) return '0:00'
  return formatTime(Math.round(totalSeconds / answeredCount))
}

function buildQuestionReviewNoteDraft(item: QueueItem, analysis: string) {
  const params = new URLSearchParams({
    draft: '1',
    draftKind: 'notes',
    draftType: item.question.type || '判断推理',
    draftSubtype: '错题复盘',
    draftModule2: item.question.subtype || '',
    draftModule3: '',
    draftTitle: `${item.question.type}${item.question.subtype ? ` · ${item.question.subtype}` : ''} 复盘`,
    draftContent: [
      `题目：${item.question.content}`.slice(0, 180),
      analysis ? `我的误区：${analysis}` : '',
      item.aiActionRule ? `下次提醒：${item.aiActionRule}` : '',
    ].filter(Boolean).join('\n\n'),
    draftSourceErrorIds: item.userErrorId ?? '',
  })
  return `/notes?${params.toString()}`
}

function buildQuestionInsightDraft(item: QueueItem, analysis: string) {
  const params = new URLSearchParams({
    draft: '1',
    draftKind: 'notes',
    draftType: item.question.type || '判断推理',
    draftSubtype: '规则沉淀',
    draftModule2: item.question.subtype || '',
    draftModule3: item.question.sub2 || '',
    draftTitle: item.question.sub2 || item.question.subtype || item.question.type || '通用规则',
    draftContent: [
      item.aiActionRule ? `规则摘要：${item.aiActionRule}` : '',
      analysis ? `AI 草稿：${analysis}` : '',
      `典型例子：${item.question.content.slice(0, 120)}`,
    ].filter(Boolean).join('\n\n'),
    draftSourceErrorIds: item.userErrorId ?? '',
  })
  return `/notes?${params.toString()}`
}

function normalizePaperAnswers(answers: Record<string, PaperAnswerState>) {
  return Object.fromEntries(
    Object.entries(answers)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([key, value]) => [key, value])
  )
}

function buildPaperSessionSnapshot(params: {
  idx: number
  step: Step
  paperAnswered: Set<number>
  paperMarked: Set<number>
  paperAnswers: Record<number, PaperAnswerState>
}) {
  return {
    currentIndex: params.idx,
    step: params.step,
    answered: Array.from(params.paperAnswered).sort((a, b) => a - b),
    marked: Array.from(params.paperMarked).sort((a, b) => a - b),
    answers: normalizePaperAnswers(
      Object.fromEntries(
        Object.entries(params.paperAnswers).map(([key, value]) => [key, value])
      )
    ),
  }
}

export default function PracticePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const paper = searchParams.get('paper')
  const paperStartAtQuestion = searchParams.get('startAtQuestion')
  const paperFocusModule = searchParams.get('focusModule')

  // O7: 记住上次模式
  const savedMode = (typeof window !== 'undefined' ? localStorage.getItem(MODE_KEY) : null) as PracticeMode | null

  const [step, setStep]         = useState<Step>(paper ? 'paper_intro' : 'mode_select')
  const [mode, setMode]         = useState<PracticeMode>(savedMode ?? 'deep')
  const [queue, setQueue]       = useState<QueueItem[]>([])
  const [paperTitle, setPaperTitle] = useState('')
  const [paperYear, setPaperYear] = useState('')
  const [paperProvince, setPaperProvince] = useState('')
  const [paperExamType, setPaperExamType] = useState('')
  const [paperBreakdown, setPaperBreakdown] = useState<Record<string, number>>({})
  const [paperResume, setPaperResume] = useState<PaperSessionRecord | null>(null)
  const [paperAnswered, setPaperAnswered] = useState<Set<number>>(new Set())
  const [paperMarked, setPaperMarked] = useState<Set<number>>(new Set())
  const [paperAnswers, setPaperAnswers] = useState<Record<number, PaperAnswerState>>({})
  const [paperCardCollapsed, setPaperCardCollapsed] = useState(false)
  const [regularAnswers, setRegularAnswers] = useState<Record<number, RegularAnswerState>>({})
  const [regularCardCollapsed, setRegularCardCollapsed] = useState(true)
  const [paperLoading, setPaperLoading] = useState(false)
  const [idx, setIdx]           = useState(0)
  const [loading, setLoading]   = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [thinking, setThinking] = useState('')
  const [thinkingSketch, setThinkingSketch] = useState('')
  const [showSketchPad, setShowSketchPad] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verdict, setVerdict]   = useState<ThinkingVerdict | null>(null)
  const [verdictFeedback, setVerdictFeedback] = useState('')
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)
  const [sessionStats, setSessionStats] = useState({ done: 0, stockifiedNow: 0 })
  const [diagnosing, setDiagnosing] = useState(false)
  const [customAnalysis, setCustomAnalysis] = useState('')
  const [aiNotice, setAiNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const sessionStartRef = useRef<string>(new Date().toISOString())

  const current  = queue[idx]
  const options  = parseOptions(current?.question?.options)
  const displayQuestionContent = current ? formatQuestionContent(current.question.content, Boolean(current.question.questionImage)) : ''
  const isLast   = idx >= queue.length - 1

  // A5: 计时器
  const timer = useTimer(current?.question?.type ?? '判断推理')
  const paperAnsweredCount = paperAnswered.size
  const paperMarkedCount = paperMarked.size
  const paperUnansweredCount = Math.max(0, queue.length - paperAnsweredCount)
  const paperSpentSeconds = Object.values(paperAnswers).reduce((sum, answer) => sum + answer.timeSpentSeconds, 0)
  const paperElapsedSeconds =
    paper && (step === 'answering' || step === 'thinking') && !paperAnswers[idx]
      ? paperSpentSeconds + timer.elapsed
      : paperSpentSeconds
  const paperProgressPercent = queue.length > 0 ? Math.round((paperAnsweredCount / queue.length) * 100) : 0
  const currentQuestionMarked = paperMarked.has(idx)
  const currentQuestionAnswered = paperAnswered.has(idx)
  const unansweredQuestionIndexes = queue
    .map((_, questionIndex) => questionIndex)
    .filter(questionIndex => !paperAnswered.has(questionIndex))
  const nextUnansweredIndex = unansweredQuestionIndexes.find(questionIndex => questionIndex > idx) ?? unansweredQuestionIndexes[0] ?? null
  const averagePerQuestion = formatAvgSeconds(paperElapsedSeconds, Math.max(paperAnsweredCount, 1))
  const rawPaperModuleLabels = queue.map(item => buildPaperModuleLabel(item.question.type, item.question.subtype))
  const normalizedPaperModuleLabels = smoothPaperModuleLabels(rawPaperModuleLabels)
  const paperModuleGroups = buildPaperModuleGroups(normalizedPaperModuleLabels)
  const currentModuleLabel = normalizedPaperModuleLabels[idx] ?? ''
  const currentModule = paperModuleGroups.find(group => group.label === currentModuleLabel) ?? null
  const currentModuleAnsweredCount = currentModule
    ? currentModule.indexes.filter(questionIndex => paperAnswered.has(questionIndex)).length
    : 0
  const currentModuleMarkedCount = currentModule
    ? currentModule.indexes.filter(questionIndex => paperMarked.has(questionIndex)).length
    : 0
  const currentModuleRemainingCount = currentModule
    ? currentModule.indexes.length - currentModuleAnsweredCount
    : 0
  const averageSecondsPerAnswered = paperAnsweredCount > 0 ? paperElapsedSeconds / paperAnsweredCount : 0
  const estimatedRemainingSeconds = paperUnansweredCount > 0 ? Math.round(averageSecondsPerAnswered * paperUnansweredCount) : 0
  const paperPaceLabel =
    averageSecondsPerAnswered === 0
      ? '等待开始'
      : averageSecondsPerAnswered <= 50
        ? '节奏偏快'
        : averageSecondsPerAnswered <= 90
          ? '节奏正常'
          : '节奏偏慢'
  const regularAnsweredIndexes = Object.keys(regularAnswers).map(Number).sort((a, b) => a - b)
  const regularAnsweredCount = regularAnsweredIndexes.length
  const regularProgressPercent = queue.length > 0 ? Math.round((regularAnsweredCount / queue.length) * 100) : 0
  const regularUnansweredIndexes = queue
    .map((_, questionIndex) => questionIndex)
    .filter(questionIndex => !(questionIndex in regularAnswers))
  const regularUnansweredCount = Math.max(0, queue.length - regularAnsweredCount)
  const nextRegularUnansweredIndex = regularUnansweredIndexes.find(questionIndex => questionIndex > idx) ?? regularUnansweredIndexes[0] ?? null
  const currentRegularAnswered = idx in regularAnswers
  const deepThinkingPrompts = [
    '我误判的依据是…',
    '正确突破口应该先看…',
    '下次我先验证…',
  ]

  function togglePaperMarked(questionIndex: number) {
    setPaperMarked(prev => {
      const next = new Set(prev)
      if (next.has(questionIndex)) next.delete(questionIndex)
      else next.add(questionIndex)
      return next
    })
  }

  function handlePaperJumpNext() {
    if (!paper) return
    if (isLast) {
      setStep('paper_submit')
      return
    }
    resetQuestionView(idx + 1)
  }

  function getPaperFocusIndex() {
    const targetNo = paperStartAtQuestion ? Number(paperStartAtQuestion) : null
    if (targetNo && Number.isFinite(targetNo) && targetNo >= 1 && targetNo <= queue.length) {
      return targetNo - 1
    }
    if (paperFocusModule) {
      const group = paperModuleGroups.find(item => item.label === paperFocusModule)
      if (group?.indexes.length) return group.indexes[0]
    }
    return null
  }

  function focusPaperAtTarget() {
    const targetIndex = getPaperFocusIndex()
    if (targetIndex == null) return
    resetQuestionView(targetIndex)
  }

  useEffect(() => {
    if (paper) {
      setPaperLoading(true)
      setLoadError('')
      setPaperAnswered(new Set())
      setPaperMarked(new Set())
      setPaperAnswers({})
      setRegularAnswers({})
      setRegularCardCollapsed(true)
      setSelected(null)
      setSubmitResult(null)
      setSubmitError('')
      setThinking('')
      setThinkingSketch('')
      setShowSketchPad(false)
      setPreviewImage(null)
      setVerdict(null)
      setVerdictFeedback('')
      setCustomAnalysis('')
      setAiNotice('')
      Promise.all([
        fetch(`/api/papers?paper=${encodeURIComponent(paper)}`),
        fetch(`/api/paper-sessions?paper=${encodeURIComponent(paper)}`),
      ])
        .then(async ([paperRes, sessionRes]) => {
          const paperData = await paperRes.json()
          if (!paperRes.ok) throw new Error(paperData.error ?? '套卷加载失败')

          const sessionData = await sessionRes.json().catch(() => ({}))
          if (sessionRes.ok) {
            setPaperResume(sessionData.paperSession ?? null)
          } else {
            setPaperResume(null)
          }

          setPaperTitle(paperData.title ?? paper)
          setPaperYear(paperData.srcYear ?? '')
          setPaperProvince(paperData.srcProvince ?? '')
          setPaperExamType(paperData.examType ?? '')
          setPaperBreakdown(paperData.typeBreakdown ?? {})
          setQueue(paperData.items ?? [])
          setStep('paper_intro')
        })
        .catch((e: any) => {
          setQueue([])
          setPaperResume(null)
          setLoadError(e?.message ?? '套卷加载失败')
        })
        .finally(() => setPaperLoading(false))
      return
    }

    setPaperTitle('')
    setPaperYear('')
    setPaperProvince('')
    setPaperExamType('')
    setPaperBreakdown({})
    setPaperResume(null)
    setPaperAnswered(new Set())
    setPaperMarked(new Set())
    setPaperAnswers({})
    setRegularAnswers({})
    setRegularCardCollapsed(true)
    setPaperLoading(false)
    setSelected(null)
    setThinking('')
    setThinkingSketch('')
    setShowSketchPad(false)
    setPreviewImage(null)
    setVerdict(null)
    setVerdictFeedback('')
    setSubmitResult(null)
    setSubmitError('')
    setCustomAnalysis('')
    setAiNotice('')
    setLoadError('')
    fetch('/api/daily-tasks')
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '今日任务加载失败')
        return data
      })
      .then(async data => {
        const errorIds    = data.reviewErrors?.map((e: any) => e.userErrorId) ?? []
        const questionIds = data.practiceQuestions ?? []

        const params = new URLSearchParams()
        if (errorIds.length)    params.set('ids',  errorIds.join(','))
        if (questionIds.length) params.set('qids', questionIds.join(','))

        if (!errorIds.length && !questionIds.length) { setQueue([]); return }

        const res   = await fetch(`/api/errors/queue?${params}`)
        const items = await res.json()
        if (!res.ok) throw new Error(items.error ?? '练习队列加载失败')
        setQueue(items)
        setStep('mode_select')
      })
      .catch((e: any) => {
        setQueue([])
        setLoadError(e?.message ?? '练习队列加载失败')
      })
  }, [paper])

  function applyPaperResume(resume: PaperSessionRecord) {
    sessionStartRef.current = resume.activitySessionId || new Date().toISOString()
    setPaperAnswered(new Set(resume.answered))
    setPaperMarked(new Set(resume.marked))
    const normalizedAnswers = Object.fromEntries(
      Object.entries(resume.answers ?? {}).map(([key, value]) => [Number(key), value])
    ) as Record<number, PaperAnswerState>
    setPaperAnswers(normalizedAnswers)
    const nextIdx = Math.min(Math.max(resume.currentIndex, 0), Math.max(queue.length - 1, 0))
    setIdx(nextIdx)
    const answeredState = normalizedAnswers[nextIdx]
    setSelected(answeredState?.selected ?? null)
      setThinking('')
      setThinkingSketch('')
      setShowSketchPad(false)
      setPreviewImage(null)
      setVerdict(null)
    setCustomAnalysis('')
    setVerdictFeedback('')
    setSubmitError('')
    setSubmitResult(answeredState?.submitResult ?? null)
    setStep(resume.step)
  }

  useEffect(() => {
    if (!paper || !paperResume || paperResume.status !== 'active' || queue.length === 0) return
    if (step !== 'answering' && step !== 'thinking' && step !== 'revealed' && step !== 'paper_submit') return

    const snapshot = buildPaperSessionSnapshot({
      idx,
      step,
      paperAnswered,
      paperMarked,
      paperAnswers,
    })

    const timerId = window.setTimeout(() => {
      fetch('/api/paper-sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync',
          sessionId: paperResume.id,
          paperKey: paper,
          paperTitle,
          paperYear,
          paperProvince,
          paperExamType,
          totalQuestions: queue.length,
          ...snapshot,
        }),
      })
        .then(async res => {
          const data = await res.json().catch(() => ({}))
          if (res.ok && data.paperSession) {
            setPaperResume(data.paperSession)
          }
        })
        .catch(() => {})
    }, 150)

    return () => window.clearTimeout(timerId)
  }, [paper, paperResume?.id, paperResume?.status, queue.length, idx, step, paperAnswered, paperMarked, paperAnswers, paperTitle, paperYear, paperProvince, paperExamType])

  // 每次切到新题开始计时
  useEffect(() => {
    if (step === 'answering') timer.start()
  }, [step, idx])

  useEffect(() => {
    if (!paper || step === 'paper_intro' || step === 'done') return

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable) return

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (paper && step === 'paper_submit') {
          setStep('answering')
          return
        }
        if (idx > 0) resetQuestionView(idx - 1)
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (paper && step === 'paper_submit') {
          setStep('answering')
          return
        }
        if (paper) handlePaperJumpNext()
        else if (idx < queue.length - 1) resetQuestionView(idx + 1)
        return
      }

      if (event.key.toLowerCase() === 'm' && (step === 'answering' || step === 'thinking' || step === 'revealed')) {
        event.preventDefault()
        togglePaperMarked(idx)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [paper, step, idx, paperAnsweredCount, paperMarkedCount, queue.length])

  function handleSelectMode(m: PracticeMode) {
    setMode(m)
    localStorage.setItem(MODE_KEY, m)  // O7
    setSubmitError('')
    setStep('answering')
  }

  async function startPaperPractice() {
    if (!paper) return
    setMode('quick')
    localStorage.setItem(MODE_KEY, 'quick')
    setSubmitError('')

    if (paperResume?.status === 'active') {
      applyPaperResume(paperResume)
      window.setTimeout(() => focusPaperAtTarget(), 0)
      return
    }

    const res = await fetch('/api/paper-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        paperKey: paper,
        paperTitle,
        paperYear,
        paperProvince,
        paperExamType,
        totalQuestions: queue.length,
        currentIndex: 0,
        step: 'answering',
        answered: [],
        marked: [],
        answers: {},
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSubmitError(data.error ?? '套卷会话创建失败')
      return
    }

    const created = data.paperSession as PaperSessionRecord | null
    if (!created) {
      setSubmitError('套卷会话创建失败')
      return
    }
    setPaperResume(created)
    applyPaperResume(created)
    window.setTimeout(() => focusPaperAtTarget(), 0)
  }

  async function restartPaperPractice() {
    if (!paper) return
    setSubmitError('')

    const res = await fetch('/api/paper-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'restart',
        paperKey: paper,
        paperTitle,
        paperYear,
        paperProvince,
        paperExamType,
        totalQuestions: queue.length,
        currentIndex: 0,
        step: 'answering',
        answered: [],
        marked: [],
        answers: {},
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSubmitError(data.error ?? '重开套卷失败')
      return
    }

    const created = data.paperSession as PaperSessionRecord | null
    if (!created) {
      setSubmitError('重开套卷失败')
      return
    }

    setPaperResume(created)
    applyPaperResume(created)
    window.setTimeout(() => focusPaperAtTarget(), 0)
  }

  function handleSelect(opt: string) {
    if (step !== 'answering') return
    if (paper && paperAnswers[idx]) return
    setSubmitError('')
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
    setSubmitError('')
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
        userThinkingImage: thinkingSketch || undefined,
        thinkingInputType: mode === 'deep' ? (thinkingSketch ? 'sketch' : 'text') : null,
        practiceMode:     mode,
        selectedAnswer:   sel,
        sessionId:        sessionStartRef.current,
      }
      if (current.source === 'practice') {
        submitBody.source     = 'practice'
        submitBody.questionId = current.questionId
        submitBody.paperSessionId = paperResume?.id
        submitBody.paperQuestionIndex = idx
      } else {
        submitBody.source      = 'error'
        submitBody.userErrorId = current.userErrorId
      }

      const res  = await fetch('/api/review/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitBody),
      })
      const result: SubmitResult & { error?: string } = await res.json()
      if (!res.ok) throw new Error(result.error ?? '提交失败，请稍后重试')
        setSubmitResult(result)
      if (paper) {
        const nextPaperAnswers = {
          ...paperAnswers,
          [idx]: {
              selected: sel,
              submitResult: result,
              timeSpentSeconds: timeSpent,
            },
          }
          const nextPaperAnswered = new Set(paperAnswered)
          nextPaperAnswered.add(idx)
          setPaperAnswers(prev => ({
            ...prev,
            [idx]: {
              selected: sel,
              submitResult: result,
              timeSpentSeconds: timeSpent,
            },
          }))
          setPaperAnswered(nextPaperAnswered)

      if (paperResume?.id) {
            fetch('/api/paper-sessions', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'sync',
                sessionId: paperResume.id,
                paperKey: paper,
                paperTitle,
                paperYear,
                paperProvince,
                paperExamType,
                totalQuestions: queue.length,
                ...buildPaperSessionSnapshot({
                  idx,
                  step: 'revealed',
                  paperAnswered: nextPaperAnswered,
                  paperMarked,
                  paperAnswers: nextPaperAnswers,
                }),
              }),
            })
              .then(async res => {
                const data = await res.json().catch(() => ({}))
                if (res.ok && data.paperSession) {
                  setPaperResume(data.paperSession)
                }
              })
              .catch(() => {})
          }
      } else {
        setRegularAnswers(prev => ({
          ...prev,
          [idx]: {
            selected: sel,
            submitResult: result,
            customAnalysis: prev[idx]?.customAnalysis,
          },
        }))
      }
      setSessionStats(s => ({
        done:          s.done + 1,
        stockifiedNow: s.stockifiedNow + (result.wasStockifiedNow ? 1 : 0),
      }))
      setStep('revealed')
    } catch (error: any) {
      setSubmitError(error?.message ?? '提交失败，请稍后重试')
      setStep(mode === 'deep' ? 'thinking' : 'answering')
    }
    setLoading(false)
  }, [current, selected, thinking, verdictFeedback, mode, paper, paperResume, paperTitle, paperYear, paperProvince, paperExamType, queue.length, paperAnswered, paperMarked, paperAnswers])

  function handleDeepReveal() {
    const timeSpent = timer.stop()
    handleReveal(selected, verdict, timeSpent)
  }

  function resetQuestionView(nextIndex: number) {
    setIdx(nextIndex)
    const answeredState = paper ? paperAnswers[nextIndex] : regularAnswers[nextIndex]
    setSelected(answeredState?.selected ?? null)
    setThinking('')
    setVerdict(null)
    setCustomAnalysis(!paper && answeredState && 'customAnalysis' in answeredState ? answeredState.customAnalysis ?? '' : '')
    setAiNotice('')
    setVerdictFeedback('')
    setSubmitError('')
    setSubmitResult(answeredState?.submitResult ?? null)
    setStep(answeredState ? 'revealed' : 'answering')
  }

  function handleSubmitPaper() {
    const finalize = async () => {
      if (paper && paperResume?.id) {
        const snapshot = buildPaperSessionSnapshot({
          idx,
          step: 'paper_submit',
          paperAnswered,
          paperMarked,
          paperAnswers,
        })
        const res = await fetch('/api/paper-sessions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'complete',
            sessionId: paperResume.id,
            paperKey: paper,
            paperTitle,
            paperYear,
            paperProvince,
            paperExamType,
            totalQuestions: queue.length,
            ...snapshot,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? '交卷失败')
      }

      const params = new URLSearchParams({ since: sessionStartRef.current })
      params.set('sessionId', sessionStartRef.current)
      if (paper) params.set('paper', paper)
      if (paperTitle) params.set('paperTitle', paperTitle)
      if (paperYear) params.set('paperYear', paperYear)
      params.set('totalExpected', String(queue.length))
      params.set('durationSeconds', String(paperElapsedSeconds))
      if (paperMarked.size > 0) {
        params.set('markedQuestions', Array.from(paperMarked).sort((a, b) => a - b).map(index => index + 1).join(','))
      }
      const unanswered = queue
        .map((_, questionIndex) => questionIndex)
        .filter(questionIndex => !paperAnswered.has(questionIndex))
        .map(questionIndex => questionIndex + 1)
      if (unanswered.length > 0) {
        params.set('unansweredQuestions', unanswered.join(','))
      }
      router.push('/practice/summary?' + params.toString())
    }

    finalize().catch(error => {
      setSubmitError(error?.message ?? '交卷失败，请重试')
    })
  }

  function handleNext() {
    if (isLast) {
      if (paper) {
        setStep('paper_submit')
        return
      }
      handleSubmitPaper()
      return
    }
    resetQuestionView(idx + 1)
  }

  // ── 模式选择 ────────────────────────────────────────────
  if (step === 'paper_intro') {
    const typeEntries = Object.entries(paperBreakdown).sort((a, b) => b[1] - a[1])
    return (
      <div data-testid="paper-intro" className="max-w-lg mx-auto px-4 pt-6 pb-8">
        <button onClick={() => router.push('/papers')} className="text-gray-400 min-h-[44px] min-w-[44px] flex items-center mb-4">←</button>

        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 mb-4">
          <p className="text-xs font-medium text-blue-500 mb-2">套卷概览</p>
          <h1 data-testid="paper-intro-title" className="text-2xl font-bold text-gray-900 leading-tight">
            {paperTitle || '整套练习'}
          </h1>
          <p className="text-sm text-gray-400 mt-2">
            {[paperYear, paperProvince, paperExamType === 'guo_kao' ? '国考' : paperExamType === 'sheng_kao' ? '省考' : paperExamType === 'tong_kao' ? '统考' : ''].filter(Boolean).join(' · ')}
          </p>

          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-2xl font-bold text-gray-900">{paperLoading ? '...' : queue.length}</p>
              <p className="text-xs text-gray-400 mt-1">总题数</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-2xl font-bold text-gray-900">{Object.keys(paperBreakdown).length}</p>
              <p className="text-xs text-gray-400 mt-1">题型数</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-2xl font-bold text-gray-900">{formatTime(paperElapsedSeconds)}</p>
              <p className="text-xs text-gray-400 mt-1">当前用时</p>
            </div>
          </div>
        </div>

        {typeEntries.length > 0 && (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 mb-4">
            <p className="text-sm font-semibold text-gray-800 mb-3">题型分布</p>
            <div className="space-y-2.5">
              {typeEntries.map(([type, count]) => (
                <div key={type}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700">{type}</span>
                    <span className="text-gray-400">{count} 题</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.round((count / Math.max(queue.length, 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5">
          <p className="text-sm font-medium text-amber-700">
            {paperLoading ? '正在加载整套题目...' : '这次会按整套卷的顺序连续做题。'}
          </p>
          <p className="text-xs text-amber-600 mt-1">
            {loadError ? loadError : '支持题号跳转、存疑标记、交卷检查和继续作答。'}
          </p>
        </div>

        {paperResume && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-5">
            <p className="text-sm font-medium text-blue-700">
              检测到上次做到第 {paperResume.currentIndex + 1} 题
            </p>
            <p className="text-xs text-blue-600 mt-1">
              已做 {paperResume.answered.length} / {queue.length} 题
              {paperResume.marked.length > 0 ? ` · 存疑 ${paperResume.marked.length} 题` : ''}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <button
                data-testid="paper-resume-restart"
                type="button"
                onClick={restartPaperPractice}
                className="py-3 border border-blue-200 bg-white text-blue-700 font-medium rounded-2xl text-sm"
              >
                重新开始
              </button>
              <button
                data-testid="paper-resume-continue"
                type="button"
                onClick={startPaperPractice}
                className="py-3 bg-blue-600 text-white font-bold rounded-2xl text-sm"
              >
                继续作答
              </button>
            </div>
          </div>
        )}

        <button
          data-testid="paper-intro-start-button"
          onClick={paperResume ? restartPaperPractice : startPaperPractice}
          disabled={paperLoading || queue.length === 0}
          className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl text-base hover:bg-blue-700 transition-colors disabled:opacity-40"
        >
          {paperLoading ? '加载中...' : queue.length > 0 ? (paperResume ? '放弃进度并重新开始' : '开始整套练习') : '当前套卷暂无题目'}
        </button>
      </div>
    )
  }

  if (step === 'paper_submit' && paper) {
    const unanswered = unansweredQuestionIndexes
    const firstMarkedQuestion = Array.from(paperMarked).sort((a, b) => a - b)[0] ?? null
    const firstUnansweredQuestion = unanswered[0] ?? null

    return (
      <div data-testid="paper-submit" className="max-w-lg mx-auto px-4 pt-6 pb-8">
        <button
          onClick={() => setStep('answering')}
          className="text-gray-400 min-h-[44px] min-w-[44px] flex items-center mb-4"
        >
          ←
        </button>

        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 mb-4">
          <p className="text-xs font-medium text-blue-500 mb-2">交卷前检查</p>
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">
            {paperTitle || '整套练习'}
          </h1>
          <p className="text-sm text-gray-400 mt-2">
            已做 {paperAnswered.size} / {queue.length} 题
            {paperMarked.size > 0 ? ` · 存疑 ${paperMarked.size} 题` : ''}
          </p>
          <div className="grid grid-cols-4 gap-3 mt-5">
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-lg font-bold text-gray-900">{paperAnswered.size}</p>
              <p className="text-xs text-gray-400 mt-1">已做</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-lg font-bold text-amber-600">{unanswered.length}</p>
              <p className="text-xs text-gray-400 mt-1">未做</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-lg font-bold text-red-600">{paperMarked.size}</p>
              <p className="text-xs text-gray-400 mt-1">存疑</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3 text-center">
              <p className="text-lg font-bold text-blue-700">{formatTime(paperElapsedSeconds)}</p>
              <p className="text-xs text-gray-400 mt-1">用时</p>
            </div>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-medium text-blue-500 mb-1">交卷提醒</p>
          <p className="text-sm text-blue-900">
            {unanswered.length > 0 && paperMarked.size > 0
              ? `还有 ${unanswered.length} 题未作答，且有 ${paperMarked.size} 题存疑。建议先补完未做题，再检查存疑题。`
              : unanswered.length > 0
                ? `还有 ${unanswered.length} 题未作答。建议先补完再交卷。`
                : paperMarked.size > 0
                  ? `你标了 ${paperMarked.size} 道存疑题。建议交卷前先快速回看。`
                  : '当前这份卷子已经可以放心交卷。'}
          </p>
        </div>

        {(firstUnansweredQuestion != null || firstMarkedQuestion != null) && (
          <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-xs font-medium text-emerald-600 mb-2">交卷前行动建议</p>
            <p className="text-sm text-emerald-900">
              {firstUnansweredQuestion != null
                ? `优先补第 ${firstUnansweredQuestion + 1} 题，再回看存疑和弱模块。`
                : `先回看第 ${firstMarkedQuestion + 1} 题的存疑内容，再决定是否直接交卷。`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {firstUnansweredQuestion != null && (
                <button
                  type="button"
                  onClick={() => resetQuestionView(firstUnansweredQuestion)}
                  className="px-3 py-2 rounded-xl bg-white border border-emerald-200 text-emerald-700 text-xs font-medium"
                >
                  跳到第 {firstUnansweredQuestion + 1} 题
                </button>
              )}
              {firstMarkedQuestion != null && (
                <button
                  type="button"
                  onClick={() => resetQuestionView(firstMarkedQuestion)}
                  className="px-3 py-2 rounded-xl bg-white border border-emerald-200 text-emerald-700 text-xs font-medium"
                >
                  跳到存疑第 {firstMarkedQuestion + 1} 题
                </button>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-800">整卷题卡</p>
            <button
              type="button"
              onClick={() => setPaperCardCollapsed(value => !value)}
              className="px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-xs text-gray-500"
            >
              {paperCardCollapsed ? '展开题卡' : '收起题卡'}
            </button>
          </div>
          {!paperCardCollapsed && (
            <>
              <div className="space-y-4">
                {paperModuleGroups.map(group => (
                  <div key={group.label}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-gray-500">{group.label}</p>
                      <span className="text-[11px] text-gray-400">{group.indexes.length} 题</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.indexes.map(questionIndex => {
                        const isCurrent = questionIndex === idx
                        const isAnswered = paperAnswered.has(questionIndex)
                        const isMarked = paperMarked.has(questionIndex)
                        return (
                          <button
                            key={questionIndex}
                            type="button"
                            onClick={() => resetQuestionView(questionIndex)}
                            className={`min-w-[42px] h-10 rounded-xl text-sm font-medium border transition-colors ${
                              isCurrent
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : isMarked
                                  ? 'bg-red-50 border-red-200 text-red-700'
                                  : isAnswered
                                    ? 'bg-green-50 border-green-200 text-green-700'
                                    : 'bg-gray-50 border-gray-200 text-gray-400'
                            }`}
                          >
                            {questionIndex + 1}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-4 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-600" /> 当前题</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> 已做</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400" /> 存疑</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-300" /> 未做</span>
                <span className="inline-flex items-center gap-1">快捷键 `← → M`</span>
              </div>
            </>
          )}
        </div>

        {unanswered.length > 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
            <p className="text-sm font-medium text-amber-700">还有 {unanswered.length} 道题未作答</p>
            <div className="flex gap-2 overflow-x-auto mt-3 pb-1">
              {unanswered.map(questionIndex => (
                <button
                  key={questionIndex}
                  type="button"
                  onClick={() => resetQuestionView(questionIndex)}
                  className="min-w-[40px] h-10 rounded-xl text-sm font-medium border bg-white border-amber-200 text-amber-700"
                >
                  {questionIndex + 1}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4 text-green-700 text-sm font-medium">
            全部题目已完成，可以直接交卷。
          </div>
        )}

        {paperMarked.size > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-5">
            <p className="text-sm font-semibold text-gray-800 mb-3">已标记存疑题</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {Array.from(paperMarked).sort((a, b) => a - b).map(questionIndex => (
                <button
                  key={questionIndex}
                  type="button"
                  onClick={() => resetQuestionView(questionIndex)}
                  className="min-w-[40px] h-10 rounded-xl text-sm font-medium border bg-red-50 border-red-200 text-red-700"
                >
                  {questionIndex + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setStep('answering')}
            className="py-4 border border-gray-200 bg-white text-gray-700 font-bold rounded-2xl text-base"
          >
            回去继续做
          </button>
          <button
            onClick={handleSubmitPaper}
            className="py-4 bg-blue-600 text-white font-bold rounded-2xl text-base hover:bg-blue-700 transition-colors"
          >
            确认交卷
          </button>
        </div>
      </div>
    )
  }

  if (step === 'mode_select') {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8">
        <h2 className="text-xl font-bold text-gray-900 mb-2">{paper ? '选择套卷练习模式' : '选择练习模式'}</h2>
        <p className="text-sm text-gray-500 mb-6">
          {paperTitle ? `${paperYear ? `${paperYear} · ` : ''}${paperTitle} · 共 ${queue.length} 道题` : `今日共 ${queue.length} 道题`}
        </p>
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
      <p className="text-4xl mb-3">📭</p><p>{paperTitle ? '这套卷暂时没有可练题目' : '今日没有待复习的题目'}</p>
      {loadError && (
        <p className="mt-3 text-sm text-red-500">{loadError}</p>
      )}
      <button onClick={() => router.push(paper ? '/papers' : '/errors/new')} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-xl text-sm">
        {paper ? '返回套卷' : '去录题'}
      </button>
    </div>
  )

  const state = getQuestionState({ masteryPercent: current.masteryPercent, isStockified: false, daysToExam: null })
  const isPaperMode = !!paper
  const paperExamLabel =
    paperExamType === 'guo_kao' ? '国考' :
    paperExamType === 'sheng_kao' ? '省考' :
    paperExamType === 'tong_kao' ? '统考' :
    ''

  return (
      <div data-testid="paper-practice-page" className="max-w-lg mx-auto px-4 pt-4 pb-24 lg:pb-8">
      {/* 进度条 + O2: 计时器 */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => {
          if (isPaperMode) {
            setStep(paperAnsweredCount > 0 ? 'paper_submit' : 'paper_intro')
            return
          }
          router.push('/dashboard')
        }} className="text-gray-400 min-h-[44px] min-w-[44px] flex items-center">←</button>
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${isPaperMode ? paperProgressPercent : (idx / Math.max(queue.length, 1)) * 100}%` }}
          />
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

      {isPaperMode ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-blue-500">整套练习</p>
              <p className="text-sm font-semibold text-gray-900 line-clamp-2">
                {paperTitle || '套卷'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {[paperYear, paperProvince, paperExamLabel].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="rounded-2xl bg-blue-50 px-3 py-2 text-center flex-shrink-0">
              <p className="text-lg font-bold text-blue-700">第 {idx + 1} 题</p>
              <p className="text-xs text-blue-400">共 {queue.length} 题</p>
            </div>
          </div>

        <div className="grid grid-cols-2 gap-2 mb-3 sm:grid-cols-3">
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
              <p className="text-sm font-bold text-gray-900">{paperProgressPercent}%</p>
              <p className="text-[11px] text-gray-400 mt-0.5">完成率</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
              <p className="text-sm font-bold text-green-600">{paperAnsweredCount}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">已做</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
              <p className="text-sm font-bold text-red-600">{paperMarkedCount}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">存疑</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
              <p className="text-sm font-bold text-blue-700">{formatTime(paperElapsedSeconds)}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">用时</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
              <p className="text-sm font-bold text-emerald-700">{formatTime(estimatedRemainingSeconds)}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">预计剩余</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
              <p className="text-sm font-bold text-gray-700">{paperPaceLabel}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">当前节奏</p>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-3 mb-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="text-slate-400">当前状态</p>
                <p className="mt-1 font-medium text-slate-700">
                  {currentQuestionAnswered
                    ? currentQuestionMarked
                      ? '本题已作答，且标记为存疑'
                      : '本题已作答'
                    : currentQuestionMarked
                      ? '本题未作答，已标记存疑'
                      : '本题待作答'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-slate-400">平均用时</p>
                <p className="mt-1 font-semibold text-slate-700">{averagePerQuestion}/题</p>
              </div>
            </div>
          </div>

          {currentModule && (
            <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-3 py-3 mb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-indigo-500">当前模块</p>
                  <p className="text-sm font-semibold text-indigo-900 mt-1">{currentModule.label}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-indigo-400">模块进度</p>
                  <p className="text-sm font-semibold text-indigo-900 mt-1">
                    {currentModuleAnsweredCount}/{currentModule.indexes.length}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="rounded-xl bg-white/70 px-2 py-2">
                  <p className="text-sm font-bold text-indigo-900">{currentModuleAnsweredCount}</p>
                  <p className="text-[11px] text-indigo-400 mt-0.5">已做</p>
                </div>
                <div className="rounded-xl bg-white/70 px-2 py-2">
                  <p className="text-sm font-bold text-amber-600">{currentModuleRemainingCount}</p>
                  <p className="text-[11px] text-indigo-400 mt-0.5">未做</p>
                </div>
                <div className="rounded-xl bg-white/70 px-2 py-2">
                  <p className="text-sm font-bold text-red-600">{currentModuleMarkedCount}</p>
                  <p className="text-[11px] text-indigo-400 mt-0.5">存疑</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
              {current.question.type}{current.question.subtype ? ` · ${current.question.subtype}` : ''}
            </span>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
              未做 {paperUnansweredCount} 题
            </span>
            <button
              type="button"
              onClick={() => togglePaperMarked(idx)}
              className={`text-xs px-2 py-1 rounded-lg border ${
                paperMarked.has(idx)
                  ? 'bg-red-50 border-red-200 text-red-600'
                  : 'bg-white border-gray-200 text-gray-500'
              }`}
            >
              {paperMarked.has(idx) ? '已标记存疑' : '标记存疑'}
            </button>
            <button
              type="button"
              onClick={() => setStep('paper_submit')}
              className="text-xs px-2 py-1 rounded-lg border bg-white border-gray-200 text-gray-500"
            >
              交卷检查
            </button>
            {nextUnansweredIndex != null && (
              <button
                type="button"
                onClick={() => resetQuestionView(nextUnansweredIndex)}
                className="text-xs px-2 py-1 rounded-lg border bg-white border-amber-200 text-amber-700"
              >
                下一道未做
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">题卡</p>
              <button
                type="button"
                onClick={() => setPaperCardCollapsed(value => !value)}
                className="px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-[11px] text-gray-500"
              >
                {paperCardCollapsed ? '展开题卡' : '收起题卡'}
              </button>
            </div>
            {!paperCardCollapsed && paperModuleGroups.map(group => (
              <div key={group.label}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-500">{group.label}</p>
                  <span className="text-[11px] text-gray-400">{group.indexes.length} 题</span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {group.indexes.map(questionIndex => {
                    const isCurrent = questionIndex === idx
                    const isAnswered = paperAnswered.has(questionIndex)
                    const isMarked = paperMarked.has(questionIndex)
                    return (
                      <button
                        key={questionIndex}
                        type="button"
                        onClick={() => resetQuestionView(questionIndex)}
                        className={`min-w-[40px] h-10 rounded-xl text-sm font-medium border transition-colors ${
                          isCurrent
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : isMarked
                              ? 'bg-red-50 border-red-200 text-red-700'
                              : isAnswered
                                ? 'bg-green-50 border-green-200 text-green-700'
                                : 'bg-gray-50 border-gray-200 text-gray-400'
                        }`}
                      >
                        {questionIndex + 1}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {!paperCardCollapsed && (
            <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-600" /> 当前题</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> 已做</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400" /> 存疑</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-300" /> 未做</span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-blue-500">今日练习</p>
              <p className="text-sm font-semibold text-gray-900">第 {idx + 1} 题 / 共 {queue.length} 题</p>
              <p className="text-xs text-gray-400 mt-1">深度和快速模式都支持跳题、回题和先跳过。</p>
            </div>
            <div className="rounded-2xl bg-blue-50 px-3 py-2 text-center flex-shrink-0">
              <p className="text-lg font-bold text-blue-700">{regularProgressPercent}%</p>
              <p className="text-xs text-blue-400">完成率</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
              <p className="text-sm font-bold text-green-600">{regularAnsweredCount}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">已做</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
              <p className="text-sm font-bold text-amber-600">{regularUnansweredCount}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">未做</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
              <p className="text-sm font-bold text-gray-900">{mode === 'deep' ? '深度' : '快速'}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">当前模式</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
              {current.question.type}{current.question.subtype ? ` · ${current.question.subtype}` : ''}
            </span>
            <StateBadge state={state} masteryPercent={current.masteryPercent} isHot={current.isHot} />
            {nextRegularUnansweredIndex != null && nextRegularUnansweredIndex !== idx && (
              <button
                type="button"
                onClick={() => resetQuestionView(nextRegularUnansweredIndex)}
                className="text-xs px-2 py-1 rounded-lg border bg-white border-amber-200 text-amber-700"
              >
                下一道未做
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">练习题卡</p>
              <button
                type="button"
                onClick={() => setRegularCardCollapsed(value => !value)}
                className="px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-[11px] text-gray-500"
              >
                {regularCardCollapsed ? '展开题卡' : '收起题卡'}
              </button>
            </div>
            {!regularCardCollapsed && (
              <>
                <div className="flex flex-wrap gap-2">
                  {queue.map((item, questionIndex) => {
                    const isCurrent = questionIndex === idx
                    const isAnswered = questionIndex in regularAnswers
                    return (
                      <button
                        key={`${item.questionId}-${questionIndex}`}
                        type="button"
                        onClick={() => resetQuestionView(questionIndex)}
                        className={`min-w-[40px] h-10 rounded-xl text-sm font-medium border transition-colors ${
                          isCurrent
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : isAnswered
                              ? 'bg-green-50 border-green-200 text-green-700'
                              : 'bg-gray-50 border-gray-200 text-gray-400'
                        }`}
                      >
                        {questionIndex + 1}
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-gray-500">
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-600" /> 当前题</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> 已做</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-300" /> 未做</span>
                  <span className="inline-flex items-center gap-1">快捷键 `← →`</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 题目 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 lg:p-6">
        {current.question.questionImage && (
          <div className="mb-4 overflow-hidden rounded-2xl border border-blue-100 bg-blue-50 lg:mb-5">
            <button
              type="button"
              onClick={() => setPreviewImage(current.question.questionImage ?? null)}
              className="block w-full text-left"
            >
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-blue-600">{getMediaLabel(current.question.type, true)}</p>
                  <p className="text-[11px] text-blue-400 mt-0.5">点击放大查看，适合资料分析、图题和多图题。</p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-blue-600 shadow-sm">放大查看</span>
              </div>
              <img
                src={current.question.questionImage}
                alt="题目图片"
                className="w-full border-t border-blue-100 object-contain bg-white lg:max-h-[560px]"
              />
            </button>
          </div>
        )}
        {current.question.type === '资料分析' && (
          <div className="mb-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            先看材料图，再看题干。资料分析题建议先扫表头、单位、时间口径和变化方向。
          </div>
        )}
        <p data-testid="paper-question-content" className="whitespace-pre-wrap text-base leading-relaxed text-gray-900 lg:text-lg lg:leading-8">{displayQuestionContent}</p>
      </div>

      {submitError && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">这道题提交失败</p>
          <p className="mt-1 text-xs text-red-600">{submitError}</p>
        </div>
      )}

      {/* 修正卡 */}
      {!isPaperMode && mode === 'deep' && step === 'answering' && (current.aiActionRule || current.question.sharedAiAnalysis) && (
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
        <div className="mb-4 space-y-2 lg:space-y-3">
          {options.map(opt => {
            const letter = opt.charAt(0)
            const isSel  = selected === letter
            const displayOpt = formatOptionLabel(opt, Boolean(current.question.questionImage))
            return (
              <button key={opt} data-testid="paper-option" onClick={() => handleSelect(opt)} disabled={step === 'thinking'}
                className={`w-full text-left px-4 py-3.5 rounded-xl border-2 transition-all text-sm min-h-[44px] lg:px-5 lg:py-4 lg:text-base
                  ${isSel ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                          : 'border-gray-100 bg-white text-gray-700 hover:border-gray-300'}
                  ${step === 'thinking' ? 'cursor-default' : 'active:scale-[0.98]'}`}>
                {displayOpt}
              </button>
            )
          })}
        </div>
      )}

      {isPaperMode && (step === 'answering' || step === 'thinking') && (
        <div className="fixed bottom-20 left-4 right-4 mx-auto max-w-[calc(512px-2rem)] lg:static lg:mt-5 lg:max-w-none">
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => resetQuestionView(Math.max(0, idx - 1))}
              disabled={idx === 0}
              className="py-3 border border-gray-200 bg-white text-gray-700 font-bold rounded-2xl text-sm disabled:opacity-40"
            >
              上一题
            </button>
            <button
              type="button"
              onClick={() => {
                if (isLast) {
                  setStep('paper_submit')
                  return
                }
                resetQuestionView(idx + 1)
              }}
              className="py-3 border border-blue-200 bg-white text-blue-700 font-bold rounded-2xl text-sm"
            >
              {isLast ? '去交卷' : (currentQuestionAnswered ? '下一题' : '先跳过')}
            </button>
            <button
              type="button"
              onClick={() => setStep('paper_submit')}
              className="py-3 bg-blue-600 text-white font-bold rounded-2xl text-sm"
            >
              交卷检查
            </button>
          </div>
        </div>
      )}

      {!isPaperMode && (step === 'answering' || step === 'thinking') && (
        <div className="fixed bottom-20 left-4 right-4 mx-auto max-w-[calc(512px-2rem)] lg:static lg:mt-5 lg:max-w-none">
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => resetQuestionView(Math.max(0, idx - 1))}
              disabled={idx === 0}
              className="py-3 border border-gray-200 bg-white text-gray-700 font-bold rounded-2xl text-sm disabled:opacity-40"
            >
              上一题
            </button>
            <button
              type="button"
              onClick={() => {
                if (isLast) return
                resetQuestionView(idx + 1)
              }}
              disabled={isLast}
              className="py-3 border border-blue-200 bg-white text-blue-700 font-bold rounded-2xl text-sm disabled:opacity-40"
            >
              {currentRegularAnswered ? '下一题' : '先跳过'}
            </button>
            <button
              type="button"
              onClick={() => setRegularCardCollapsed(value => !value)}
              className="py-3 bg-blue-600 text-white font-bold rounded-2xl text-sm"
            >
              {regularCardCollapsed ? '展开题卡' : '收起题卡'}
            </button>
          </div>
        </div>
      )}

      {/* 选项（揭晓后） */}
      {step === 'revealed' && (
        <div className="space-y-2 mb-4">
          {options.map(opt => {
            const letter = opt.charAt(0)
            const isRight = letter === current.question.answer
            const isWrong = letter === selected && !isRight
            const displayOpt = formatOptionLabel(opt, Boolean(current.question.questionImage))
            return (
              <div key={opt} className={`w-full text-left px-4 py-3.5 rounded-xl border-2 text-sm
                ${isRight ? 'border-green-500 bg-green-50 text-green-900 font-medium'
                : isWrong ? 'border-red-400 bg-red-50 text-red-700'
                : 'border-gray-100 bg-white text-gray-400'}`}>
                {displayOpt}
                {isRight && <span className="ml-2 text-green-600">✓ 正确答案</span>}
                {isWrong  && <span className="ml-2 text-red-500">✗ 我的选择</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* 深度模式思路框 */}
      {!isPaperMode && mode === 'deep' && step === 'thinking' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-sm font-medium text-gray-700">写下你的解题思路</p>
              <p className="text-xs text-gray-400 mt-1">可以直接打字，也可以打开草稿板随手写写画画。</p>
            </div>
            <button
              type="button"
              onClick={() => setShowSketchPad(true)}
              className="shrink-0 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700"
            >
              {thinkingSketch ? '查看草稿板' : '打开草稿板'}
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {deepThinkingPrompts.map(prompt => (
              <button
                key={prompt}
                type="button"
                onClick={() => setThinking(prev => prev.includes(prompt) ? prev : `${prev.trim()}${prev.trim() ? '\n' : ''}${prompt}`)}
                className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600"
              >
                {prompt}
              </button>
            ))}
          </div>
          <textarea value={thinking} onChange={e => setThinking(e.target.value)}
            placeholder="你是怎么想到选这个答案的？写关键步骤即可..."
            className="w-full h-28 text-sm text-gray-700 border border-gray-100 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {thinkingSketch && (
            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-medium text-blue-600">已保存草稿</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSketchPad(true)}
                    className="text-xs text-blue-600 underline"
                  >
                    继续修改
                  </button>
                  <button
                    type="button"
                    onClick={() => setThinkingSketch('')}
                    className="text-xs text-red-500 underline"
                  >
                    删除草稿
                  </button>
                </div>
              </div>
              <img src={thinkingSketch} alt="解题草稿" className="max-h-40 rounded-xl border border-blue-100 bg-white" />
              <p className="mt-2 text-[11px] text-blue-500">草稿会随本次深度练习一起提交，方便后续复盘。</p>
            </div>
          )}
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
          {!isPaperMode && current.aiActionRule && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-xs text-blue-500 font-medium mb-1">📌 下次遇到类似题</p>
              <p className="text-sm text-blue-800 font-medium">{current.aiActionRule}</p>
            </div>
          )}

          {/* B7: 个性化AI诊断按钮 */}
          {!isPaperMode && !customAnalysis ? (
            <button onClick={async () => {
              setDiagnosing(true)
              try {
                const res = await fetch(`/api/errors/${current.userErrorId}/diagnose`, { method: 'POST' })
                const d   = await res.json()
                if (d.analysis) {
                  setCustomAnalysis(d.analysis)
                  setAiNotice(d.message ?? '')
                  setRegularAnswers(prev => ({
                    ...prev,
                    [idx]: {
                      selected: prev[idx]?.selected ?? selected ?? '',
                      submitResult: prev[idx]?.submitResult ?? submitResult,
                      customAnalysis: d.analysis,
                    },
                  }))
                }
              } finally { setDiagnosing(false) }
            }} disabled={diagnosing}
              className="w-full py-2.5 border border-purple-200 text-purple-600 rounded-xl text-sm font-medium hover:bg-purple-50 disabled:opacity-50">
              {diagnosing ? '🤖 深度诊断中...' : '🔬 个性化深度诊断'}
            </button>
          ) : (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
              <p className="text-xs text-purple-500 font-medium mb-1">🔬 个性化诊断</p>
              {aiNotice && (
                <p className="mb-2 text-xs text-purple-500">{aiNotice}</p>
              )}
              <p className="text-sm text-purple-800 whitespace-pre-wrap leading-relaxed">{customAnalysis}</p>
            </div>
          )}

          {!isPaperMode && (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => router.push(buildQuestionReviewNoteDraft(current, customAnalysis || current.question.sharedAiAnalysis || current.question.analysis || ''))}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-700"
              >
                沉淀成笔记
              </button>
              <button
                type="button"
                onClick={() => router.push(buildQuestionInsightDraft(current, customAnalysis || current.aiActionRule || ''))}
                className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-medium text-blue-700"
              >
                补充规则摘要
              </button>
            </div>
          )}

          {!isPaperMode && (current.question.analysis || current.question.sharedAiAnalysis) && (
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
      {step === 'revealed' && !isPaperMode && mode === 'deep' && selected !== current?.question?.answer && (
        <CustomDiagnosisButton
          questionContent={current.question.content}
          correctAnswer={current.question.answer}
          myAnswer={selected ?? ''}
        />
      )}

      {step === 'revealed' && (
        <div className="fixed bottom-20 left-4 right-4 max-w-[calc(512px-2rem)] mx-auto">
          {isPaperMode ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  if (idx === 0) return
                  resetQuestionView(Math.max(0, idx - 1))
                }}
                disabled={idx === 0}
                className="py-4 border border-gray-200 bg-white text-gray-700 font-bold rounded-2xl text-base disabled:opacity-40"
              >
                上一题
              </button>
              <button onClick={handleNext}
                className="py-4 bg-blue-600 text-white font-bold rounded-2xl text-base hover:bg-blue-700 transition-colors">
                {isLast ? '去交卷检查' : '下一题'}
              </button>
            </div>
          ) : (
            <button onClick={handleNext}
              className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl text-base hover:bg-blue-700 transition-colors">
              {isLast ? '查看今日总结 →' : '下一题 →'}
            </button>
          )}
        </div>
      )}

      {showSketchPad && (
        <SketchPadModal
          initialImage={thinkingSketch}
          onClose={() => setShowSketchPad(false)}
          onSave={(image) => {
            setThinkingSketch(image)
            setShowSketchPad(false)
          }}
        />
      )}

      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
          <div className="w-full max-w-lg rounded-t-3xl bg-white p-4 sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">{getMediaLabel(current?.question?.type ?? '', true)}</p>
                <p className="text-xs text-gray-400 mt-0.5">可以放大、缩小查看，适合资料分析和图形题。</p>
              </div>
              <button onClick={() => setPreviewImage(null)} className="text-2xl text-gray-400">×</button>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-2xl border border-gray-100 bg-gray-50 p-2">
              <img src={previewImage} alt="题目放大图" className="w-full rounded-xl bg-white object-contain" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SketchPadModal({
  initialImage,
  onClose,
  onSave,
}: {
  initialImage: string
  onClose: () => void
  onSave: (image: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const drawingRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper) return

    const width = Math.max(320, Math.min(wrapper.clientWidth, 560))
    const height = Math.round(width * 0.68)
    canvas.width = width * window.devicePixelRatio
    canvas.height = height * window.devicePixelRatio
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = '#1f2937'

    if (initialImage) {
      const img = new Image()
      img.onload = () => {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
      }
      img.src = initialImage
    }
  }, [initialImage])

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const point = getPoint(event)
    drawingRef.current = true
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const point = getPoint(event)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  }

  function stopDrawing() {
    drawingRef.current = false
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const width = Number.parseFloat(canvas.style.width || '0')
    const height = Number.parseFloat(canvas.style.height || '0')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }

  function saveCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    onSave(canvas.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="text-base font-semibold text-gray-900">解题草稿板</p>
            <p className="text-xs text-gray-400 mt-1">像在草稿纸上一样写写画画，保存后会跟随这道题一起复盘。</p>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400 leading-none">×</button>
        </div>
        <div className="p-4">
          <div ref={wrapperRef} className="rounded-2xl border border-gray-200 bg-gray-50 p-2 overflow-auto">
            <canvas
              ref={canvasRef}
              className="rounded-xl bg-white touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDrawing}
              onPointerLeave={stopDrawing}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
            <span className="rounded-full bg-gray-100 px-2.5 py-1">适合列条件</span>
            <span className="rounded-full bg-gray-100 px-2.5 py-1">适合画图推理</span>
            <span className="rounded-full bg-gray-100 px-2.5 py-1">适合资料草算</span>
          </div>
        </div>
        <div className="flex gap-3 px-4 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={clearCanvas} className="flex-1 rounded-2xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700">
            清空
          </button>
          <button onClick={saveCanvas} className="flex-1 rounded-2xl bg-blue-600 py-3 text-sm font-bold text-white">
            保存草稿
          </button>
        </div>
      </div>
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
