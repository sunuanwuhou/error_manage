import { extractProcessSteps, normalizeChoiceAnswer } from '@/lib/error-analysis'

type StandardCompareInput = {
  questionContent?: string | null
  questionAnalysis?: string | null
  correctAnswer?: string | null
  userAnswer?: string | null
  processSummary?: string | null
  wrongStepIndex?: number | null
  wrongStepText?: string | null
}

export type ProcessCompareResult = {
  standardSteps: Array<{ index: number; text: string }>
  userSteps: Array<{ index: number; text: string }>
  divergenceStepIndex: number | null
  divergenceReason: string
  replayFocusRange: { start: number; end: number } | null
  standardSummary: string
  answerCompare: {
    userAnswer: string
    correctAnswer: string
    isCorrect: boolean
  }
}

function normalizeLine(line: string) {
  return line
    .replace(/^[-*\d.、\s]+/, '')
    .replace(/^（[一二三四五六七八九十]+）/, '')
    .replace(/^第[一二三四五六七八九十\d]+步[:：]?/, '')
    .trim()
}

function splitStandardSteps(questionAnalysis: string) {
  const lines = String(questionAnalysis || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)

  const explicitSteps = lines
    .map((line, index) => {
      const normalized = normalizeLine(line)
      if (!normalized) return null
      if (/^(解析|答案|故选|因此|所以|总结)[:：]?/.test(normalized) && lines.length > 1) return null
      return { index: index + 1, text: normalized }
    })
    .filter((item): item is { index: number; text: string } => Boolean(item && item.text))

  if (explicitSteps.length) return explicitSteps.slice(0, 8)

  const roughSentences = String(questionAnalysis || '')
    .split(/[。；\n]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map((text, index) => ({ index: index + 1, text }))

  return roughSentences.slice(0, 8)
}

function buildReason(userStepText: string, standardStepText: string) {
  if (!userStepText && standardStepText) return '用户过程缺少该步骤，标准解法在这里有关键动作。'
  if (/审题|题意|设问|关键词/.test(userStepText) && !/审题|题意|设问|关键词/.test(standardStepText)) return '用户在审题层停留过多，但标准解法此处已经进入计算或推理。'
  if (/公式|定义|模型/.test(userStepText) && !/公式|定义|模型/.test(standardStepText)) return '用户这里调用的规则与标准解法重心不一致，疑似模型选错。'
  if (/排除|选项/.test(userStepText) && !/排除|选项/.test(standardStepText)) return '用户较早进入选项排除，但标准解法此处仍在建立题干逻辑。'
  if (/计算|列式|算/.test(userStepText) && !/计算|列式|算/.test(standardStepText)) return '用户较早进入计算，但标准解法此处仍需先确认关系。'
  return '用户过程与标准解法在这里开始不一致，建议从该步起逐步对照。'
}

export function compareProcessWithStandard(input: StandardCompareInput): ProcessCompareResult {
  const standardSteps = splitStandardSteps(String(input.questionAnalysis || ''))
  const userSteps = extractProcessSteps(String(input.processSummary || ''))
  const normalizedUserAnswer = normalizeChoiceAnswer(input.userAnswer)
  const normalizedCorrectAnswer = normalizeChoiceAnswer(input.correctAnswer)

  let divergenceStepIndex = Number(input.wrongStepIndex || 0) || null
  if (!divergenceStepIndex) {
    if (!userSteps.length && standardSteps.length) divergenceStepIndex = 1
    else if (userSteps.length && standardSteps.length) {
      const maxLen = Math.max(userSteps.length, standardSteps.length)
      for (let i = 0; i < maxLen; i += 1) {
        const userText = normalizeLine(userSteps[i]?.text || '')
        const standardText = normalizeLine(standardSteps[i]?.text || '')
        if (!userText || !standardText) {
          divergenceStepIndex = i + 1
          break
        }
        const userTokens = userText.split(/[，,、\s]/).filter(Boolean)
        const overlap = userTokens.filter(token => standardText.includes(token))
        if (overlap.length === 0) {
          divergenceStepIndex = i + 1
          break
        }
      }
    }
  }

  const reason = buildReason(
    String(input.wrongStepText || userSteps.find(step => step.index === divergenceStepIndex)?.text || ''),
    String(standardSteps.find(step => step.index === divergenceStepIndex)?.text || ''),
  )

  return {
    standardSteps,
    userSteps,
    divergenceStepIndex,
    divergenceReason: reason,
    replayFocusRange: divergenceStepIndex ? { start: Math.max(1, divergenceStepIndex - 1), end: divergenceStepIndex + 1 } : null,
    standardSummary: standardSteps.length ? standardSteps.map(item => `${item.index}. ${item.text}`).join('\n') : String(input.questionAnalysis || ''),
    answerCompare: {
      userAnswer: normalizedUserAnswer,
      correctAnswer: normalizedCorrectAnswer,
      isCorrect: Boolean(normalizedUserAnswer) && normalizedUserAnswer === normalizedCorrectAnswer,
    },
  }
}
