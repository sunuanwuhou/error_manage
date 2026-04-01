export type ParsedOption = {
  key: 'A' | 'B' | 'C' | 'D'
  text: string
}

export type ParsedQuestion = {
  number: number
  stem: string
  options: ParsedOption[]
  answer: string | null
  analysis?: string | null
  sourceSlice: string
}

const QUESTION_START_RE = /^\s*(\d+)\.\s*【([^】]+)】\s*(.*)$/
const OPTION_RE = /^\s*([A-D])\.\s*(.*)$/
const ANSWER_RE = /正确答案\s*[:：]\s*([A-D](?:\s*,\s*[A-D]){0,3}|正确|错误|A,B,C,D|A,B,C|A,B,D|A,C,D|B,C,D|A,B|A,C|A,D|B,C|B,D|C,D)/
const ANALYSIS_RE = /(?:解析|考点)\s*[:：]\s*(.*)$/

export type ParseDocxInput = {
  paragraphs: string[]
}

export type ParseDocxOutput = {
  questions: ParsedQuestion[]
  meta: {
    total: number
    answered: number
    optionComplete: number
  }
}

function cleanText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeAnswer(raw: string): string {
  const compact = raw.replace(/\s+/g, '').replace(/，/g, ',')
  if (compact === '正确' || compact === '错误') return compact
  return compact.split(',').filter(Boolean).join(',')
}

function toSourceSlice(lines: string[]): string {
  return lines.map(cleanText).filter(Boolean).join('\n')
}

export function parseGuangdongDocx({ paragraphs }: ParseDocxInput): ParseDocxOutput {
  const rows = paragraphs.map(cleanText).filter(Boolean)
  const questions: ParsedQuestion[] = []

  let current: {
    number: number
    stem: string
    options: Map<'A' | 'B' | 'C' | 'D', string>
    answer: string | null
    analysis: string | null
    rawLines: string[]
  } | null = null

  const flush = () => {
    if (!current) return
    questions.push({
      number: current.number,
      stem: current.stem.trim(),
      options: (['A', 'B', 'C', 'D'] as const)
        .filter((key) => current!.options.has(key))
        .map((key) => ({ key, text: current!.options.get(key)! })),
      answer: current.answer,
      analysis: current.analysis,
      sourceSlice: toSourceSlice(current.rawLines),
    })
    current = null
  }

  for (const row of rows) {
    const qMatch = row.match(QUESTION_START_RE)
    if (qMatch) {
      flush()
      current = {
        number: Number(qMatch[1]),
        stem: qMatch[3] ?? '',
        options: new Map(),
        answer: null,
        analysis: null,
        rawLines: [row],
      }
      continue
    }

    if (!current) continue
    current.rawLines.push(row)

    const optionMatch = row.match(OPTION_RE)
    if (optionMatch) {
      current.options.set(optionMatch[1] as 'A' | 'B' | 'C' | 'D', optionMatch[2].trim())
      continue
    }

    const answerMatch = row.match(ANSWER_RE)
    if (answerMatch) {
      current.answer = normalizeAnswer(answerMatch[1])
      const analysisMatch = row.match(ANALYSIS_RE)
      if (analysisMatch) current.analysis = analysisMatch[1].trim()
      continue
    }

    if (row.startsWith('--------------------------------------------------')) continue

    if (current.options.size === 0 && !row.startsWith('正确答案')) {
      current.stem = current.stem ? `${current.stem}\n${row}` : row
    }
  }

  flush()

  return {
    questions,
    meta: {
      total: questions.length,
      answered: questions.filter((item) => Boolean(item.answer)).length,
      optionComplete: questions.filter((item) => item.options.length >= 2).length,
    },
  }
}

export function buildCurrentQuestionSlice(
  allQuestions: ParsedQuestion[],
  currentNumber: number,
): string | null {
  const target = allQuestions.find((item) => item.number === currentNumber)
  return target?.sourceSlice ?? null
}
