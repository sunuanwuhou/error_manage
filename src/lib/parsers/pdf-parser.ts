import pdf from 'pdf-parse'

export interface ParsedQuestion {
  no: string
  content: string
  questionImage?: string
  options: string[]
  answer: string
  type: string
  analysis: string
  rawText: string
}

type SectionType = '判断题' | '单项选择题' | '多项选择题' | ''

type DraftQuestion = {
  no: string
  stemLines: string[]
  tailLines: string[]
  sectionType: SectionType
}

const TYPE_JUDGE: SectionType = '判断题'
const TYPE_SINGLE: SectionType = '单项选择题'
const TYPE_MULTI: SectionType = '多项选择题'
const QUESTION_NO_RE = /^(\d{1,3})\.$/
const OPTION_MARKER_RE = /^[A-D][.、]/

export async function parsePdfBuffer(buffer: Buffer): Promise<{
  questions: ParsedQuestion[]
  answerMap: Record<string, string>
  warnings: string[]
  rawText: string
}> {
  const data = await pdf(buffer)
  const parsed = parsePdfText(data.text)
  return {
    ...parsed,
    rawText: data.text,
  }
}

export function parsePdfText(rawText: string): {
  questions: ParsedQuestion[]
  answerMap: Record<string, string>
  warnings: string[]
} {
  const warnings: string[] = []
  const lines = normalizePdfLines(rawText)
  const answerMap = extractAnswerMap(lines)
  const questions = extractQuestions(lines, answerMap)

  if (questions.length === 0) {
    warnings.push('PDF 未解析出有效题目，若是扫描版请优先走 OCR 或截图导入。')
  }
  if (Object.keys(answerMap).length === 0) {
    warnings.push('PDF 未检测到答案区，本次会先导入题干和选项，答案可在预览页补充。')
  }

  return { questions, answerMap, warnings }
}

function normalizePdfLines(rawText: string) {
  const rawLines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const lines: string[] = []

  for (const rawLine of rawLines) {
    if (rawLine.includes('本试卷由') && rawLine.includes('页')) continue
    if (/^20\d{2}年/.test(rawLine) && (rawLine.includes('试卷') || rawLine.includes('真题'))) continue
    if (rawLine.includes('考生回忆版') || rawLine.includes('粉笔用户')) continue

    const sectionType = detectSectionType(rawLine)
    if (sectionType) {
      lines.push(sectionType)
      continue
    }

    const inlineQuestionNo = extractInlineQuestionNo(rawLine)
    if (inlineQuestionNo && !OPTION_MARKER_RE.test(rawLine)) {
      lines.push(inlineQuestionNo.stem)
      lines.push(`${inlineQuestionNo.no}.`)
      continue
    }

    lines.push(rawLine)
  }

  return lines
}

function detectSectionType(line: string): SectionType {
  if (!/^[一二三四五六七八九十]+[.、]/.test(line)) return ''
  if (line.includes(TYPE_JUDGE)) return TYPE_JUDGE
  if (line.includes(TYPE_SINGLE)) return TYPE_SINGLE
  if (line.includes(TYPE_MULTI)) return TYPE_MULTI
  return ''
}

function extractInlineQuestionNo(line: string) {
  const match = line.match(/(\d{1,3})\.\s*$/)
  if (!match?.[1]) return null

  const marker = match[0]
  const stem = line.slice(0, line.length - marker.length).trim()
  if (!stem) return null

  return {
    stem,
    no: match[1],
  }
}

function extractAnswerMap(lines: string[]) {
  const answerMap: Record<string, string> = {}
  const answerStart = lines.findIndex(line => line.includes('答案') || line.includes('参考答案'))
  const searchLines = answerStart >= 0 ? lines.slice(answerStart) : lines.slice(-60)

  for (const line of searchLines) {
    for (const match of line.matchAll(/(\d{1,3})[.、:\-\s]*([ABCD])/gi)) {
      answerMap[match[1]] = match[2].toUpperCase()
    }
  }

  return answerMap
}

function extractQuestions(lines: string[], answerMap: Record<string, string>) {
  const questions: ParsedQuestion[] = []
  let currentSectionType: SectionType = ''
  let pendingStemLines: string[] = []
  let active: DraftQuestion | null = null

  const flushActive = () => {
    if (!active) return
    const question = finalizeQuestion(active, answerMap[active.no] ?? '')
    if (question.content.length > 5) questions.push(question)
    active = null
  }

  for (const line of lines) {
    const sectionType = detectSectionType(line)
    if (sectionType) {
      flushActive()
      currentSectionType = sectionType
      pendingStemLines = []
      continue
    }

    const questionNo = line.match(QUESTION_NO_RE)?.[1]
    if (questionNo) {
      flushActive()
      active = {
        no: questionNo,
        stemLines: pendingStemLines,
        tailLines: [],
        sectionType: currentSectionType,
      }
      pendingStemLines = []
      continue
    }

    const nextQuestion = extractInlineQuestionNo(line)
    if (active && nextQuestion && !OPTION_MARKER_RE.test(line)) {
      flushActive()
      active = {
        no: nextQuestion.no,
        stemLines: [nextQuestion.stem],
        tailLines: [],
        sectionType: currentSectionType,
      }
      pendingStemLines = []
      continue
    }

    if (!active) {
      pendingStemLines.push(line)
      continue
    }

    if (isTailLine(line, active.tailLines)) {
      active.tailLines.push(line)
      continue
    }

    pendingStemLines.push(line)
  }

  flushActive()
  return questions
}

function isTailLine(line: string, tailLines: string[]) {
  if (OPTION_MARKER_RE.test(line)) return true
  if (line.startsWith('答案：') || line.startsWith('解析：')) return true
  if (tailLines.length === 0) return false

  const previous = tailLines[tailLines.length - 1] ?? ''
  if (!OPTION_MARKER_RE.test(previous)) return false
  if (tailLines.some(item => item.startsWith('D.') || item.includes('D.'))) return false
  if (looksLikeQuestionStem(line)) return false
  return true
}

function looksLikeQuestionStem(line: string) {
  if (!line) return false
  if (line.includes('（ ）') || line.includes('( )')) return true
  if (line.includes('下列') || line.includes('根据') || line.includes('关于')) return true
  if (/[。？！?]$/.test(line)) return true
  return false
}

function finalizeQuestion(draft: DraftQuestion, answer: string): ParsedQuestion {
  const content = sanitizeQuestionText(draft.stemLines.join(' '))
  const optionText = draft.tailLines.join('\n')
  const options = extractOptions(optionText)
  const analysis = extractAnalysis(optionText)

  return {
    no: draft.no,
    content,
    questionImage: '',
    options,
    answer,
    type: inferQuestionType(content, draft.sectionType, options),
    analysis,
    rawText: [...draft.stemLines, `${draft.no}.`, ...draft.tailLines].join('\n'),
  }
}

function sanitizeQuestionText(text: string) {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/^[（(](判断题|单项选择题|多项选择题)[）)]/, '')
    .trim()
  const explicitStem = normalized.match(/[（(](判断题|单项选择题|多项选择题)[）)].+$/)
  return explicitStem?.[0] ?? normalized
}

function extractOptions(optionText: string) {
  if (!optionText.trim()) return []

  return optionText
    .replace(/\n+/g, ' ')
    .split(/(?=[A-D][.、])/)
    .map(item => item.trim())
    .filter(item => OPTION_MARKER_RE.test(item))
    .map(item => {
      const letter = item[0]
      const text = item.slice(2).trim().replace(/\s+/g, ' ')
      return `${letter}.${text}`
    })
}

function extractAnalysis(optionText: string) {
  const match = optionText.match(/(?:答案解析|解析|答案)[:：]\s*([\s\S]+)$/)
  return match?.[1]?.trim() ?? ''
}

function inferQuestionType(content: string, sectionType: SectionType, options: string[]) {
  if (sectionType) return sectionType
  if (content.includes('资料') || content.includes('图表')) return '资料分析'
  if (options.length >= 4) return TYPE_SINGLE
  return TYPE_JUDGE
}
