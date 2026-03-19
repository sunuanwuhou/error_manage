// src/lib/parsers/pdf-parser.ts
// ============================================================
// PDF 真题解析器
// 支持格式：粉笔 / 华图 / 中公 / 标准四选一格式
// ============================================================

export interface ParsedQuestion {
  no:       string      // 题号
  content:  string      // 题目正文
  questionImage?: string // 题目图片（如有）
  options:  string[]    // ["A.xxx", "B.xxx", "C.xxx", "D.xxx"]
  answer:   string      // 正确答案 A/B/C/D（来自答案页，可能为空）
  type:     string      // 推断的题型
  analysis: string      // 解析文字（如有）
  rawText:  string      // 原始文本，供人工核查
}

// 题型推断关键词
const TYPE_KEYWORDS: Array<{ type: string; keywords: string[] }> = [
  { type: '判断推理', keywords: ['逻辑判断', '图形推理', '类比推理', '定义判断', '翻译推理', '削弱', '加强', '假设', '图形'] },
  { type: '言语理解', keywords: ['言语理解', '选词填空', '阅读理解', '语句排序', '语句填入', '文段'] },
  { type: '数量关系', keywords: ['数量关系', '数字推理', '数学运算', '解方程', '计算'] },
  { type: '资料分析', keywords: ['资料分析', '图表', '增长率', '比重', '倍数'] },
  { type: '常识判断', keywords: ['常识判断', '常识', '法律', '经济', '历史', '地理', '科技'] },
]

function guessType(text: string): string {
  const t = text.slice(0, 100)
  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (keywords.some(k => t.includes(k))) return type
  }
  return '判断推理'  // 默认
}

// ============================================================
// 核心解析函数
// ============================================================
export function parsePdfText(rawText: string): {
  questions:  ParsedQuestion[]
  answerMap:  Record<string, string>  // { "1": "A", "2": "C", ... }
  warnings:   string[]
} {
  const warnings: string[] = []
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)

  // Step 1: 提取答案表（通常在文末，格式各异）
  const answerMap = extractAnswerMap(lines, warnings)

  // Step 2: 提取题目块
  const questions = extractQuestions(lines, answerMap, warnings)

  return { questions, answerMap, warnings }
}

// ============================================================
// 答案表提取
// 支持格式：
//   1.A  2.B  3.C  4.D
//   1、A  2、B
//   【答案】1A2B3C4D
//   答案：1-A  2-B  3-C
// ============================================================
function extractAnswerMap(lines: string[], warnings: string[]): Record<string, string> {
  const answerMap: Record<string, string> = {}

  // 查找答案区块（通常包含"答案"关键词或大量连续的 数字+字母 模式）
  const answerSectionStart = lines.findIndex(l =>
    /答案|参考答案|解析|answer/i.test(l) || /^[1-9]\d*[.、．][ABCD]/i.test(l)
  )

  const searchLines = answerSectionStart >= 0
    ? lines.slice(answerSectionStart)
    : lines.slice(-Math.min(80, lines.length))  // 兜底：取最后80行

  for (const line of searchLines) {
    // 格式1：1.A 2.B 3.C（空格分隔）
    const pattern1 = line.matchAll(/(\d+)[.、．\-\s]([ABCD])/gi)
    for (const m of pattern1) {
      answerMap[m[1]] = m[2].toUpperCase()
    }

    // 格式2：连续无分隔 1A2B3C4D
    const pattern2 = line.match(/^(\d+[ABCD])+$/)
    if (pattern2) {
      const pairs = line.matchAll(/(\d+)([ABCD])/gi)
      for (const m of pairs) answerMap[m[1]] = m[2].toUpperCase()
    }
  }

  if (Object.keys(answerMap).length === 0) {
    warnings.push('未检测到答案表，答案列将为空，请手动填写或从答案页补录')
  }

  return answerMap
}

// ============================================================
// 题目块提取
// 题目通常以 "数字." 或 "数字、" 开头
// ============================================================
function extractQuestions(
  lines:     string[],
  answerMap: Record<string, string>,
  warnings:  string[]
): ParsedQuestion[] {
  const questions: ParsedQuestion[] = []

  // 找到所有题目起始行（数字开头 + 句子内容，不是纯答案行）
  const questionStarts: Array<{ lineIdx: number; no: string }> = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 题目行特征：以题号开头，后跟文字内容（不是单个字母答案）
    const m = line.match(/^(\d{1,3})[.、．。\s](.{5,})/)
    if (m && !/^[ABCD][.、．]/.test(m[2])) {
      // 排除答案行（如 "1.A 判断正确"）
      if (!/^[ABCD]$/.test(m[2].trim())) {
        questionStarts.push({ lineIdx: i, no: m[1] })
      }
    }
  }

  if (questionStarts.length === 0) {
    warnings.push('未检测到题目，可能是扫描版PDF（图片），建议使用截图识别功能')
    return []
  }

  // 逐题提取
  for (let qi = 0; qi < questionStarts.length; qi++) {
    const { lineIdx, no } = questionStarts[qi]
    const nextStart = questionStarts[qi + 1]?.lineIdx ?? lines.length

    const block = lines.slice(lineIdx, nextStart)
    const question = parseQuestionBlock(block, no, answerMap[no] ?? '')
    if (question.content.length > 5) {
      questions.push(question)
    }
  }

  return questions
}

function parseQuestionBlock(
  block:    string[],
  no:       string,
  answer:   string
): ParsedQuestion {
  const rawText = block.join('\n')
  const options: string[] = []
  const contentLines: string[] = []
  const analysisLines: string[] = []

  let inAnalysis = false

  for (const line of block) {
    // 选项行：A. / A、 / （A）
    if (/^[ABCD][.、．\uff0e\uff01]/.test(line) || /^（[ABCD]）/.test(line)) {
      const letter = line.match(/[ABCD]/)?.[0] ?? ''
      const text   = line.replace(/^[（]?[ABCD][）]?[.、．\uff0e\uff01\s]*/, '').trim()
      if (letter && text) options.push(`${letter}.${text}`)
      continue
    }

    // 解析行
    if (/^(解析|【解析】|答案解析|\[解析\])/.test(line)) {
      inAnalysis = true
      analysisLines.push(line.replace(/^(解析|【解析】|答案解析|\[解析\])[:：]?/, '').trim())
      continue
    }

    if (inAnalysis) {
      analysisLines.push(line)
    } else {
      // 题目正文（去掉题号前缀）
      const stripped = line.replace(/^\d{1,3}[.、．。\s]+/, '').trim()
      if (stripped && !stripped.match(/^答案[:：]?\s*[ABCD]/)) {
        contentLines.push(stripped)
      }
    }
  }

  const content  = contentLines.join(' ').trim()
  const analysis = analysisLines.join(' ').trim()

  return {
    no,
    content,
    options,
    answer,
    type:     guessType(content),
    analysis,
    rawText,
  }
}
