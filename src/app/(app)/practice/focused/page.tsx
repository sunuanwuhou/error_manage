'use client'
// src/app/(app)/practice/focused/page.tsx
// 同错因聚焦模式（B2）+ 计时训练模式（B1）

import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { SPEED_LIMITS } from '@/lib/mastery-engine'

interface FocusedItem {
  userErrorId:   string
  questionId:    string
  masteryPercent: number
  aiActionRule?: string
  reviewCount:   number
  question: {
    content: string; questionImage?: string | null; options: string; answer: string
    type: string; subtype?: string; sharedAiAnalysis?: string
  }
}

interface TagOption { tag: string; count: number }

const formatOptionLabel = (option: string, hasQuestionImage: boolean) => {
  if (!option) return ''
  return option
    .replace(/^([A-D])\.\1$/, '$1.见图')
    .replace(/@t\d+/gi, hasQuestionImage ? '见图' : '[图]')
    .replace(/\[图[A-D]?\]/g, hasQuestionImage ? '见图' : '[图]')
}

const getMediaLabel = (questionType: string, hasImage: boolean) => {
  if (!hasImage) return ''
  return questionType === '资料分析' ? '资料 / 材料图' : '题目图片'
}

const formatQuestionContent = (content: string, hasImage: boolean) => {
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

export default function FocusedPracticePage() {
  const router     = useRouter()
  const params     = useSearchParams()
  const mode       = params.get('mode') as 'focused' | 'timed' | null
  const [tag, setTag]             = useState(params.get('tag') ?? '')
  const [items, setItems]         = useState<FocusedItem[]>([])
  const [tags, setTags]           = useState<TagOption[]>([])
  const [idx, setIdx]             = useState(0)
  const [timedMode, setTimedMode] = useState(mode === 'timed')
  const [selected, setSelected]   = useState<string | null>(null)
  const [revealed, setRevealed]   = useState(false)
  const [thinking, setThinking]   = useState('')
  const [thinkingSketch, setThinkingSketch] = useState('')
  const [showSketchPad, setShowSketchPad] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [timeLeft, setTimeLeft]   = useState(0)
  const [timeSpent, setTimeSpent] = useState(0)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const startRef  = useRef(Date.now())
  const timerRef  = useRef<NodeJS.Timeout>()

  function load(t: string, currentMode: 'focused' | 'timed' | null) {
    setLoading(true)
    setError('')
    const url = currentMode === 'timed'
      ? '/api/practice/modes?mode=timed'
      : `/api/practice/focused?tag=${encodeURIComponent(t)}`
    fetch(url)
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '专项练习加载失败')
        return data
      })
      .then(data => {
        setItems(data.errors ?? data.items ?? [])
        setTags(data.availableTags ?? [])
        setIdx(0); setSelected(null); setRevealed(false); setPreviewImage(null)
        setLoading(false)
      })
      .catch((e: any) => {
        setItems([])
        setTags([])
        setError(e?.message ?? '专项练习加载失败')
        setLoading(false)
      })
  }

  useEffect(() => {
    setTimedMode(mode === 'timed')
    load(tag, mode)
  }, [tag, mode])

  const current = items[idx]
  const opts: string[] = current?.question?.options ? JSON.parse(current.question.options) : []
  const displayQuestionContent = current ? formatQuestionContent(current.question.content, Boolean(current.question.questionImage)) : ''

  // 计时器（B1）
  useEffect(() => {
    if (!current || revealed) { clearInterval(timerRef.current); return }
    startRef.current = Date.now()
    const limit = SPEED_LIMITS[current.question.type] ?? 90
    const timedLimit = timedMode ? Math.floor(limit * 0.6) : limit
    setTimeLeft(timedLimit)

    timerRef.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - startRef.current) / 1000)
      const remaining = timedLimit - elapsed
      setTimeLeft(Math.max(0, remaining))
      if (timedMode && remaining <= 0) {
        clearInterval(timerRef.current)
        handleReveal('__timeout__')
      }
    }, 500)
    return () => clearInterval(timerRef.current)
  }, [idx, revealed, timedMode, current])

  function handleSelect(opt: string) {
    if (revealed) return
    const letter = opt.charAt(0)
    setSelected(letter)
    handleReveal(letter)
  }

  async function handleReveal(answer: string) {
    if (!current) return
    clearInterval(timerRef.current)
    const spent = Math.round((Date.now() - startRef.current) / 1000)
    setTimeSpent(spent)
    setRevealed(true)

    const isCorrect = answer === current.question.answer
    const limit = SPEED_LIMITS[current.question.type] ?? 90
    const isSlowCorrect = isCorrect && spent > (timedMode ? limit * 0.6 : limit)

    await fetch('/api/review/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userErrorId:  current.userErrorId,
        isCorrect:    answer !== '__timeout__' ? isCorrect : false,
        timeSpent:    spent,
        isSlowCorrect,
        userThinkingText: thinking || undefined,
        userThinkingImage: thinkingSketch || undefined,
        thinkingInputType: thinkingSketch ? 'sketch' : (thinking ? 'text' : null),
        practiceMode: timedMode ? 'timed' : 'focused',
      }),
    })
  }

  function handleNext() {
    if (idx >= items.length - 1) {
      router.push(mode === 'timed' ? '/practice/special?mode=timed' : '/practice/special')
      return
    }
    setIdx(i => i + 1); setSelected(null); setRevealed(false); setThinking(''); setThinkingSketch(''); setPreviewImage(null)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">加载中...</div>

  if (error) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-16 text-center">
        <p className="text-4xl mb-3">⚠️</p>
        <p className="font-medium text-gray-700">{error}</p>
        <button onClick={() => router.push('/practice/special')} className="mt-6 px-6 py-3 border border-gray-200 rounded-2xl text-gray-600">
          返回专项训练
        </button>
      </div>
    )
  }

  // 标签选择页
  if (mode !== 'timed' && (!tag || items.length === 0)) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/practice/special')} className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center">←</button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">聚焦模式</h1>
            <p className="text-xs text-gray-400 mt-0.5">集中攻克一个错因类型</p>
          </div>
        </div>
        {tags.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p>还没有足够的错因数据</p>
            <p className="text-xs mt-1">至少需要2道同类错因的题目</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tags.map(t => (
              <button key={t.tag} onClick={() => setTag(t.tag)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{t.tag}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t.count} 道题</p>
                  </div>
                  <span className="text-gray-300 text-xl">›</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (mode === 'timed' && items.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-16 text-center">
        <p className="text-4xl mb-3">⏱️</p>
        <p className="font-medium text-gray-700">当前没有需要提速的题目</p>
        <p className="text-sm text-gray-400 mt-1">当连续出现慢正确时，这里会自动生成专项提速队列。</p>
        <button onClick={() => router.push('/practice/special')} className="mt-6 px-6 py-3 border border-gray-200 rounded-2xl text-gray-600">
          返回专项训练
        </button>
      </div>
    )
  }

  const limit = SPEED_LIMITS[current?.question?.type ?? ''] ?? 90
  const timedLimit = timedMode ? Math.floor(limit * 0.6) : limit
  const timeRatio = timeLeft / timedLimit
  const isOvertime = timeLeft <= 0

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24 lg:pb-8">
      {/* 头部 */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => {
            if (mode === 'timed') {
              router.push('/practice/special')
              return
            }
            setTag('')
          }}
          className="text-gray-400 text-xl min-h-[44px] min-w-[44px] flex items-center"
        >
          ←
        </button>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">{timedMode ? '计时提速专项' : `聚焦：${tag}`}</span>
            <span className="text-xs text-gray-400">{idx + 1}/{items.length}</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${((idx + 1) / items.length) * 100}%` }} />
          </div>
        </div>
        {/* B1: 计时模式切换 */}
        <button onClick={() => setTimedMode(m => !m)}
          className={`text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors
            ${timedMode ? 'bg-red-50 border-red-200 text-red-600' : 'border-gray-200 text-gray-500'}`}>
          {timedMode ? '⏱ 限时' : '⏱ 普通'}
        </button>
      </div>

      {/* 计时器（B1）*/}
      {!revealed && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{
                width:           `${timeRatio * 100}%`,
                backgroundColor: timeRatio > 0.5 ? '#22c55e' : timeRatio > 0.25 ? '#f59e0b' : '#ef4444',
              }} />
          </div>
          <span className={`text-sm tabular-nums font-mono w-8 text-right ${isOvertime ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
            {timeLeft}s
          </span>
        </div>
      )}

      {/* 行动规则（聚焦模式的关键，做题前提示）*/}
      {current.aiActionRule && !revealed && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 mb-3">
          <p className="text-xs text-blue-600">
            <span className="font-medium">记住：</span>{current.aiActionRule}
          </p>
        </div>
      )}

      {/* 题目 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-3 lg:p-6">
        {current.question.questionImage && (
          <div className="mb-4 overflow-hidden rounded-2xl border border-blue-100 bg-blue-50">
            <button type="button" onClick={() => setPreviewImage(current.question.questionImage ?? null)} className="block w-full text-left">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-blue-600">{getMediaLabel(current.question.type, true)}</p>
                  <p className="text-[11px] text-blue-400 mt-0.5">点击放大查看，适合资料分析和图形题。</p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-blue-600 shadow-sm">放大查看</span>
              </div>
              <img src={current.question.questionImage} alt="题目图片" className="w-full border-t border-blue-100 object-contain bg-white lg:max-h-[520px]" />
            </button>
          </div>
        )}
        {current.question.type === '资料分析' && (
          <div className="mb-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            资料分析建议先扫材料图里的标题、单位和时间口径，再开始做题。
          </div>
        )}
        <p className="whitespace-pre-wrap text-base leading-relaxed text-gray-900 lg:text-lg lg:leading-8">{displayQuestionContent}</p>
      </div>

      {/* 选项 */}
      <div className="mb-4 space-y-2 lg:space-y-3">
        {opts.map(opt => {
          const letter = opt.charAt(0)
          const isCorrect = letter === current.question.answer
          const isMine = letter === selected
          const displayOpt = formatOptionLabel(opt, Boolean(current.question.questionImage))
          return (
            <button key={opt} onClick={() => handleSelect(opt)} disabled={revealed}
              className={`w-full text-left px-4 py-3.5 rounded-xl border-2 text-sm min-h-[44px] transition-all active:scale-[0.98] lg:px-5 lg:py-4 lg:text-base
                ${!revealed
                  ? isMine ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white hover:border-gray-300'
                  : isCorrect ? 'border-green-500 bg-green-50 text-green-900'
                  : isMine   ? 'border-red-400 bg-red-50 text-red-700'
                  : 'border-gray-100 bg-white text-gray-400'
                }`}>
              {displayOpt}
              {revealed && isCorrect && <span className="ml-2 text-green-600 text-xs">✓</span>}
              {revealed && isMine && !isCorrect && <span className="ml-2 text-red-500 text-xs">✗</span>}
            </button>
          )
        })}
      </div>

      {!revealed && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-700">专项草稿</p>
              <p className="text-xs text-gray-400 mt-1">所有练习模式都支持先记规则、画草稿，再提交。</p>
            </div>
            <button
              type="button"
              onClick={() => setShowSketchPad(true)}
              className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700"
            >
              {thinkingSketch ? '查看草稿板' : '打开草稿板'}
            </button>
          </div>
          <textarea
            value={thinking}
            onChange={e => setThinking(e.target.value)}
            rows={4}
            placeholder="记一句这道题的突破口、陷阱或判断规则。"
            className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {thinkingSketch && (
            <img src={thinkingSketch} alt="专项草稿" className="mt-3 max-h-40 rounded-xl border border-blue-100 bg-white" />
          )}
        </div>
      )}

      {/* 揭晓后解析 */}
      {revealed && (
        <div className="space-y-2 mb-4">
          {timedMode && timeSpent > 0 && (
            <div className={`rounded-xl p-3 text-sm border ${timeSpent > timedLimit ? 'bg-red-50 border-red-200 text-red-600' : 'bg-green-50 border-green-200 text-green-600'}`}>
              用时 {timeSpent}s · 限时 {timedLimit}s
              {timeSpent > timedLimit ? ' · 超时了，需要继续提速' : ' · 达标！'}
            </div>
          )}
          {current.question.sharedAiAnalysis && (
            <div className="bg-white rounded-xl border border-gray-100 p-3">
              <p className="text-xs text-gray-400 mb-1">解析</p>
              <p className="text-sm text-gray-700">{current.question.sharedAiAnalysis}</p>
            </div>
          )}
        </div>
      )}

      {revealed && (
        <button onClick={handleNext}
          className="fixed bottom-20 left-4 right-4 max-w-lg mx-auto rounded-2xl bg-blue-600 py-4 font-bold text-white lg:static lg:mt-4 lg:w-full">
          {idx >= items.length - 1 ? '完成 ✓' : '下一题 →'}
        </button>
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
                <p className="text-xs text-gray-400 mt-0.5">放大查看材料图或图题细节。</p>
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
  const drawingRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const width = 360
    const height = 240
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = '#111827'

    if (initialImage) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, width, height)
      img.src = initialImage
    }
  }, [initialImage])

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    drawingRef.current = true
    const p = point(event)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = point(event)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function end() {
    drawingRef.current = false
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">专项草稿板</h3>
          <button onClick={onClose} className="text-2xl text-gray-400">×</button>
        </div>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="w-full touch-none rounded-2xl border border-gray-200 bg-white"
        />
        <div className="mt-4 grid grid-cols-3 gap-3">
          <button onClick={clearCanvas} className="rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600">清空</button>
          <button onClick={onClose} className="rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600">取消</button>
          <button onClick={() => onSave(canvasRef.current?.toDataURL('image/png') || '')} className="rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white">保存</button>
        </div>
      </div>
    </div>
  )
}
