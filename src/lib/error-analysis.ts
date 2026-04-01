import type { ErrorAnalysisRecord, ErrorTypePrimary, TriggerEvidence } from '@/contracts/error-analysis.types'
import type { AttemptRecord, ReviewTaskRecord, ScoreRecord } from '@/contracts/record-layer.types'

function nowIso() {
  return new Date().toISOString()
}

export function buildRuntimeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeChoiceAnswer(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

export function extractProcessSteps(processSummary: string) {
  return String(processSummary || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const matched = line.match(/^(\d+)[\.、]\s*(.+)$/)
      if (!matched) return null
      return { index: Number(matched[1]), text: matched[2].trim() }
    })
    .filter((item): item is { index: number; text: string } => Boolean(item && item.text))
}

function detectWrongStep(processSummary: string) {
  const steps = extractProcessSteps(processSummary)
  if (!steps.length) return { wrongStepIndex: undefined as number | undefined, wrongStepText: processSummary || undefined }

  const ruleList = [
    { type: '审题错误' as ErrorTypePrimary, regex: /没看清|看错|题意|审题|问非所问|否定词|偷换/ },
    { type: '公式错误' as ErrorTypePrimary, regex: /公式|套错|定义记错|模型错|判定标准错/ },
    { type: '计算错误' as ErrorTypePrimary, regex: /计算|算错|抄错|笔算|约分|进位|小数点/ },
    { type: '选项排除错误' as ErrorTypePrimary, regex: /排除|先排|剩下|干扰项|保留项/ },
    { type: '推理断裂' as ErrorTypePrimary, regex: /因为|所以|推出|因此|假设|推出不了|跳步/ },
    { type: '时间分配错误' as ErrorTypePrimary, regex: /时间不够|来不及|蒙|赶时间/ },
  ]

  for (const step of steps) {
    for (const rule of ruleList) {
      if (rule.regex.test(step.text)) {
        return { wrongStepIndex: step.index, wrongStepText: step.text }
      }
    }
  }

  return { wrongStepIndex: steps[steps.length - 1]?.index, wrongStepText: steps[steps.length - 1]?.text }
}

export function scoreChoiceQuestion(args: {
  questionId: string
  attemptId: string
  userAnswer: unknown
  correctAnswer: unknown
  judgeMode?: ScoreRecord['judgeMode']
}): ScoreRecord {
  const user = normalizeChoiceAnswer(args.userAnswer)
  const correct = normalizeChoiceAnswer(args.correctAnswer)
  const isCorrect = Boolean(user) && user === correct
  return {
    scoreId: buildRuntimeId('score'),
    questionId: args.questionId,
    attemptId: args.attemptId,
    isCorrect,
    scoreValue: isCorrect ? 1 : 0,
    maxScore: 1,
    scoreStatus: isCorrect ? 'correct' : 'wrong',
    judgeMode: args.judgeMode || 'rule',
    judgeSummary: isCorrect ? '答案匹配标准答案' : `答案不匹配，用户答案=${user || '空'}，标准答案=${correct || '空'}`,
    createdAt: nowIso(),
  }
}

function classifyPrimaryError(args: {
  userAnswer: string
  correctAnswer: string
  processSummary: string
  score: ScoreRecord
}): { primary: ErrorTypePrimary; evidence: TriggerEvidence[]; rootCause: string; nextAction: string; trainingMode: ErrorAnalysisRecord['trainingMode']; secondary: string[]; confidence: number } {
  const process = args.processSummary
  const user = args.userAnswer
  const correct = args.correctAnswer
  const evidence: TriggerEvidence[] = []
  const secondary: string[] = []

  if (args.score.isCorrect) {
    evidence.push({ code: 'score.correct', label: '判分正确', message: '本次作答正确，无需错因定位', source: 'score' })
    return {
      primary: '表达不完整',
      evidence,
      rootCause: '本次已答对，无错误链路',
      nextAction: '保持题感，可直接进入下一题或变式训练。',
      trainingMode: 'variant_training',
      secondary,
      confidence: 0.98,
    }
  }

  evidence.push({ code: 'score.wrong', label: '判分错误', message: `用户答案=${user || '空'}，标准答案=${correct || '空'}`, source: 'score' })

  if (!process.trim()) {
    evidence.push({ code: 'process.empty', label: '过程缺失', message: '未提交思路/过程记录，无法定位具体失误步骤', source: 'process' })
    return {
      primary: '过程缺失无法定位',
      evidence,
      rootCause: '缺少过程数据，当前只能确认结果错误，无法精确定位错误步骤。',
      nextAction: '下次作答时补充过程画布或思路记录，再进入错因分析。',
      trainingMode: 'process_replay',
      secondary,
      confidence: 0.55,
    }
  }

  if (/没看清|看错|题意|审题|问非所问|否定词/.test(process)) {
    evidence.push({ code: 'process.reading', label: '审题信号', message: '过程记录中出现审题偏差信号词', source: 'process' })
    return {
      primary: '审题错误',
      evidence,
      rootCause: '过程记录显示题干关键词或设问方向读取偏差。',
      nextAction: '回到原题重读设问，单独练“题干关键词+设问限定”标注。',
      trainingMode: 'redo_same_question',
      secondary,
      confidence: 0.86,
    }
  }

  if (/公式|套错|数量关系|资料分析公式|定义记错/.test(process)) {
    evidence.push({ code: 'process.formula', label: '公式信号', message: '过程记录中出现公式/定义套用错误信号', source: 'process' })
    secondary.push('概念错误')
    return {
      primary: '公式错误',
      evidence,
      rootCause: '过程记录显示公式或规则套用不当。',
      nextAction: '回看对应知识点定义与公式适用条件，再做同错因变式题。',
      trainingMode: 'same_error_training',
      secondary,
      confidence: 0.84,
    }
  }

  if (/计算|算错|抄错|列式对|结果错|笔算/.test(process)) {
    evidence.push({ code: 'process.calc', label: '计算信号', message: '过程记录中出现计算或抄写错误信号', source: 'process' })
    return {
      primary: '计算错误',
      evidence,
      rootCause: '思路方向可能正确，但中间运算或转写出现失误。',
      nextAction: '保留原解法，做一次慢算复盘，并抽同类计算题限时再练。',
      trainingMode: 'same_error_training',
      secondary,
      confidence: 0.83,
    }
  }

  if (/排除|先排|剩下|犹豫|干扰项/.test(process)) {
    evidence.push({ code: 'process.option', label: '排除信号', message: '过程记录中出现选项排除链路', source: 'process' })
    return {
      primary: '选项排除错误',
      evidence,
      rootCause: '排除链中至少有一步依据不足或误删正确项。',
      nextAction: '逐项复核每个选项的排除理由，改写成“保留/排除”两栏再练。',
      trainingMode: 'redo_same_question',
      secondary,
      confidence: 0.8,
    }
  }

  if (/时间不够|来不及|蒙|赶时间/.test(process)) {
    evidence.push({ code: 'process.time', label: '时间信号', message: '过程记录中出现时间压力信号', source: 'process' })
    return {
      primary: '时间分配错误',
      evidence,
      rootCause: '作答节奏失衡，导致判断仓促或未完成充分验证。',
      nextAction: '先复盘慢做版本，再做一轮同类限时训练。',
      trainingMode: 'variant_training',
      secondary,
      confidence: 0.78,
    }
  }

  if (/因为|所以|推出|因此|假设|推到这一步/.test(process)) {
    evidence.push({ code: 'process.reasoning', label: '推理链信号', message: '存在明确推理链但结果错误', source: 'process' })
    return {
      primary: '推理断裂',
      evidence,
      rootCause: '过程记录显示存在中间推导，但至少一环推理不成立或跳步。',
      nextAction: '按步骤重写推理链，找出第一处无法成立的连接点。',
      trainingMode: 'process_replay',
      secondary,
      confidence: 0.76,
    }
  }

  evidence.push({ code: 'process.generic', label: '通用错因', message: '存在过程记录，但未触发更具体规则', source: 'process' })
  return {
    primary: '概念错误',
    evidence,
    rootCause: '结果错误且过程未显示明确计算/审题/排除问题，默认归入知识或概念理解偏差。',
    nextAction: '回看对应知识点与标准解析，再做同类题验证。',
    trainingMode: 'note_review',
    secondary,
    confidence: 0.68,
  }
}

export function buildAttemptRecord(args: {
  questionId: string
  userAnswer: unknown
  processSessionIds?: string[]
  answerMeta?: Record<string, unknown>
}): AttemptRecord {
  const ts = nowIso()
  return {
    attemptId: buildRuntimeId('attempt'),
    questionId: args.questionId,
    userAnswer: args.userAnswer,
    normalizedAnswer: normalizeChoiceAnswer(args.userAnswer),
    answerMeta: args.answerMeta || {},
    processSessionIds: args.processSessionIds || [],
    status: 'submitted',
    submittedAt: ts,
    createdAt: ts,
    updatedAt: ts,
  }
}

export function buildErrorAnalysis(args: {
  questionId: string
  attempt: AttemptRecord
  score: ScoreRecord
  correctAnswer: unknown
  processSummary?: string
  generatedBy?: string
}): ErrorAnalysisRecord {
  const processSummary = String(args.processSummary || '').trim()
  const user = normalizeChoiceAnswer(args.attempt.userAnswer)
  const correct = normalizeChoiceAnswer(args.correctAnswer)
  const classified = classifyPrimaryError({
    userAnswer: user,
    correctAnswer: correct,
    processSummary,
    score: args.score,
  })
  const stepDetection = detectWrongStep(processSummary)

  return {
    analysisId: buildRuntimeId('analysis'),
    questionId: args.questionId,
    attemptId: args.attempt.attemptId,
    scoreId: args.score.scoreId,
    processIds: args.attempt.processSessionIds,
    isWrong: !args.score.isCorrect,
    scoreStatus: args.score.scoreStatus,
    confidence: classified.confidence,
    errorTypePrimary: classified.primary,
    errorTypeSecondary: classified.secondary,
    rootCause: classified.rootCause,
    triggerEvidence: classified.evidence,
    wrongStepIndex: stepDetection.wrongStepIndex,
    wrongStepText: stepDetection.wrongStepText,
    nextAction: classified.nextAction,
    retryRecommended: !args.score.isCorrect,
    reviewKnowledgeNodeIds: [],
    reviewNoteIds: [],
    trainingMode: classified.trainingMode,
    analysisVersion: 2,
    analysisMode: 'rule',
    generatedAt: nowIso(),
    generatedBy: args.generatedBy || 'system-rule-engine',
  }
}

export function buildReviewTask(args: { questionId: string; attemptId: string; analysis: ErrorAnalysisRecord }): ReviewTaskRecord {
  const ts = nowIso()
  const priorityMap: Record<ErrorAnalysisRecord['trainingMode'], number> = {
    redo_same_question: 90,
    same_error_training: 85,
    process_replay: 80,
    note_review: 70,
    variant_training: 60,
  }

  return {
    reviewTaskId: buildRuntimeId('review_task'),
    questionId: args.questionId,
    sourceAttemptId: args.attemptId,
    sourceAnalysisId: args.analysis.analysisId,
    taskType: args.analysis.trainingMode,
    title: `复盘任务：${args.analysis.errorTypePrimary}`,
    description: args.analysis.nextAction,
    priority: priorityMap[args.analysis.trainingMode] || 50,
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
  }
}
