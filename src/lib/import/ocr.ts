import type { ParsedQuestion } from '../parsers/pdf-parser'

const QUESTION_TYPES = ['判断推理', '言语理解', '数量关系', '资料分析', '常识判断'] as const

type QuestionType = (typeof QUESTION_TYPES)[number]

type OcrPayload = {
  content?: unknown
  question?: unknown
  stem?: unknown
  options?: unknown
  choices?: unknown
  answer?: unknown
  analysis?: unknown
  explanation?: unknown
  type?: unknown
  questionType?: unknown
  error?: unknown
}

export interface NormalizedOcrQuestion extends ParsedQuestion {
  warnings: string[]
}

function toText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item): string => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) return toText((item as { text?: unknown }).text)
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return typeof value === 'string' ? value.trim() : ''
}

function stripMarkdownFences(text: string) {
  return text.replace(/```json/gi, '').replace(/```/g, '').trim()
}

function extractJsonBlock(text: string) {
  const clean = stripMarkdownFences(text)
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return clean.slice(start, end + 1)
  }
  return clean
}

function parseJsonObject(text: string): OcrPayload {
  const candidate = extractJsonBlock(text)
  if (!candidate) {
    throw new Error('OCR 未返回可解析内容')
  }
  const parsed = JSON.parse(candidate)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('OCR 返回格式异常')
  }
  return parsed as OcrPayload
}

function normalizeAnswer(answer: string) {
  return answer.toUpperCase().replace(/[（()）\s]/g, '').match(/[ABCD]/)?.[0] ?? ''
}

function normalizeOption(option: string, index: number) {
  const letter = ['A', 'B', 'C', 'D'][index]
  if (!letter) return ''
  const content = option
    .replace(/^[A-D][.．、:：)\]\s-]*/i, '')
    .replace(/^[（(]?[A-D][)）][.．、:：\s-]*/i, '')
    .trim()
  return content ? `${letter}.${content}` : ''
}

function extractOptionsFromObject(value: Record<string, unknown>) {
  return ['A', 'B', 'C', 'D']
    .map(letter => {
      const raw = toText(value[letter] ?? value[letter.toLowerCase()])
      return raw ? `${letter}.${raw}` : ''
    })
    .filter(Boolean)
}

function extractInlineOptions(content: string) {
  const matches = Array.from(content.matchAll(/([A-D])[.．、:：]\s*([\s\S]*?)(?=\s*[A-D][.．、:：]|$)/g))
  if (matches.length < 2) {
    return { content, options: [] as string[] }
  }

  const options = matches
    .slice(0, 4)
    .map((match, index) => normalizeOption(`${match[1]}.${match[2]}`, index))
    .filter(Boolean)

  const firstOptionIndex = matches[0]?.index ?? content.length
  return {
    content: content.slice(0, firstOptionIndex).trim(),
    options,
  }
}

function normalizeOptions(raw: unknown, fallbackContent: string, warnings: string[]) {
  if (Array.isArray(raw)) {
    const normalized = raw
      .map((item, index) => normalizeOption(toText(item), index))
      .filter(Boolean)
    if (normalized.length > 0) return { options: normalized, content: fallbackContent }
  }

  if (raw && typeof raw === 'object') {
    const normalized = extractOptionsFromObject(raw as Record<string, unknown>)
    if (normalized.length > 0) return { options: normalized, content: fallbackContent }
  }

  const inline = extractInlineOptions(fallbackContent)
  if (inline.options.length > 0) {
    warnings.push('选项来自题干内联拆分，请复核图片题版式')
    return inline
  }

  return { options: [] as string[], content: fallbackContent }
}

function normalizeType(rawType: string, content: string): QuestionType {
  const text = `${rawType} ${content}`
  if (/资料|图表|增长率|比重|同比|表格/.test(text)) return '资料分析'
  if (/数量|数学|工程|概率|方程|行程|利润/.test(text)) return '数量关系'
  if (/常识|法律|政治|经济|历史|地理|科技/.test(text)) return '常识判断'
  if (/言语|选词|文段|排序|填空|主旨|阅读/.test(text)) return '言语理解'
  return '判断推理'
}

export function normalizeOcrPayload(payload: OcrPayload): NormalizedOcrQuestion {
  if (toText(payload.error)) {
    throw new Error(toText(payload.error))
  }

  const warnings: string[] = []
  const rawContent = toText(payload.content) || toText(payload.question) || toText(payload.stem)
  const normalizedType = normalizeType(toText(payload.type) || toText(payload.questionType), rawContent)
  const normalizedAnswer = normalizeAnswer(toText(payload.answer))
  const normalizedAnalysis = toText(payload.analysis) || toText(payload.explanation)
  const optionSource = payload.options ?? payload.choices
  const { options, content } = normalizeOptions(optionSource, rawContent, warnings)

  if (!content) {
    throw new Error('未识别到题目正文')
  }

  if (options.length < 2) {
    warnings.push('OCR 识别到的选项不足 2 个')
  }

  if (!normalizedAnswer) {
    warnings.push('OCR 未识别到明确答案')
  }

  if (options.length > 0 && options.length < 4) {
    warnings.push(`OCR 仅识别到 ${options.length} 个选项`)
  }

  return {
    no: '1',
    content,
    options,
    answer: normalizedAnswer,
    type: normalizedType,
    analysis: normalizedAnalysis,
    rawText: JSON.stringify(payload),
    warnings,
  }
}

export function parseOcrCompletion(text: string) {
  return normalizeOcrPayload(parseJsonObject(text))
}

export function buildQuestionOcrPrompt() {
  return `这是一道公务员行测题目的截图，请严格提取一道题并以 JSON 返回：
{
  "content": "题目正文（完整）",
  "options": ["A.选项内容", "B.选项内容", "C.选项内容", "D.选项内容"],
  "answer": "正确答案字母（如有）",
  "analysis": "解析文字（如有）",
  "type": "题型（判断推理/言语理解/数量关系/资料分析/常识判断）"
}
要求：
1. 只返回一个 JSON 对象，不要 markdown。
2. 如果选项在题干里，也要拆成 options 数组。
3. 如果答案不确定，answer 留空字符串。
4. 如果图片里没有完整题目，返回 {"error":"无法识别完整题目"}`
}

export async function recognizeQuestionFromImage(file: File) {
  const apiKey = process.env.MINIMAX_API_KEY
  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY 未配置')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const base64 = buffer.toString('base64')
  const mimeType = file.type || 'image/jpeg'

  const res = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'abab6.5s-chat',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: buildQuestionOcrPrompt() },
        ],
      }],
      max_tokens: 1000,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = toText((data as { base_resp?: { status_msg?: unknown } }).base_resp?.status_msg)
      || toText((data as { error?: unknown }).error)
      || `OCR 请求失败（HTTP ${res.status}）`
    throw new Error(message)
  }

  const text = toText((data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content)
  return parseOcrCompletion(text)
}
