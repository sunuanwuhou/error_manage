export type WrongWorkbenchItem = {
  id: string
  questionId: string
  content: string
  questionType?: string
  userAnswer?: string
  correctAnswer?: string
  errorReason?: string
  masteryPercent?: number
  nextReviewAt?: string | null
}

export function classifyErrorReason(reason?: string | null) {
  const value = String(reason || '').trim()
  if (!value) return '未归类'
  if (/审题|题意|没看清|看错/.test(value)) return '审题问题'
  if (/概念|定义|知识点|不会|不懂/.test(value)) return '知识点不清'
  if (/计算|粗心|算错|抄错/.test(value)) return '计算/粗心'
  if (/时间|来不及|赶时间/.test(value)) return '时间不足'
  if (/逻辑|推理|分析/.test(value)) return '分析推理问题'
  return '其他'
}

export function buildReasonBreakdown(items: WrongWorkbenchItem[]) {
  const map: Record<string, number> = {}
  items.forEach(item => {
    const key = classifyErrorReason(item.errorReason)
    map[key] = (map[key] || 0) + 1
  })
  return Object.entries(map).sort((a, b) => b[1] - a[1])
}

export function buildNextAction(items: WrongWorkbenchItem[]) {
  if (!items.length) {
    return '当前没有错题，建议回到练习页继续做题，或提高题量。'
  }

  const dueCount = items.filter(item => item.nextReviewAt).length
  const lowMasteryCount = items.filter(item => Number(item.masteryPercent ?? 0) < 60).length
  const reasonBreakdown = buildReasonBreakdown(items)
  const topReason = reasonBreakdown[0]?.[0] || ''

  if (dueCount >= 5) {
    return `当前有 ${dueCount} 道待复习错题，建议先清理复习队列，再开新练习。`
  }

  if (lowMasteryCount >= 5) {
    return `当前有 ${lowMasteryCount} 道低掌握度错题，建议优先做错题再练。`
  }

  if (topReason && topReason !== '未归类') {
    return `当前错因主要集中在“${topReason}”，建议先按这一类问题复盘，再做下一轮练习。`
  }

  return '建议先看错题列表中的低掌握度项，再进入再练。'
}
