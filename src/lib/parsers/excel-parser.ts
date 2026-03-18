// src/lib/parsers/excel-parser.ts
// ============================================================
// Excel/CSV 真题解析器
// 支持格式：
//   A: 粉笔导出格式（题目/A/B/C/D/答案/解析/题型）
//   B: 自制格式（序号/题目内容/选项A/选项B/选项C/选项D/正确答案）
//   C: 简化格式（题目/答案，无选项）
// ============================================================

import type { ParsedQuestion } from './pdf-parser'

// SheetJS 在运行时动态 import（避免 Edge Runtime 问题）
async function readWorkbook(buffer: Buffer) {
  const XLSX = await import('xlsx')
  return XLSX.read(buffer, { type: 'buffer' })
}

// ============================================================
// 列名标准化映射
// ============================================================
const COLUMN_ALIASES: Record<string, string[]> = {
  content:  ['题目', '题目内容', '题干', '正文', 'question', 'content', '题'],
  optionA:  ['A', '选项A', '选A', 'A选项', 'option_a'],
  optionB:  ['B', '选项B', '选B', 'B选项', 'option_b'],
  optionC:  ['C', '选项C', '选C', 'C选项', 'option_c'],
  optionD:  ['D', '选项D', '选D', 'D选项', 'option_d'],
  answer:   ['答案', '正确答案', '参考答案', 'answer', '正确选项'],
  type:     ['题型', '类型', '科目', 'type'],
  analysis: ['解析', '解题思路', '答案解析', 'analysis', '解析说明'],
  no:       ['序号', '编号', '题号', 'no', 'id', '#'],
}

function normalizeHeader(h: string): string {
  const trimmed = String(h).trim()
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === trimmed.toLowerCase())) {
      return field
    }
  }
  return trimmed.toLowerCase()
}

// ============================================================
// 主解析函数
// ============================================================
export async function parseExcelBuffer(buffer: Buffer): Promise<{
  questions: ParsedQuestion[]
  warnings:  string[]
  sheetName: string
}> {
  const warnings: string[] = []
  const wb = await readWorkbook(buffer)

  // 取第一个 Sheet
  const sheetName = wb.SheetNames[0]
  const sheet     = wb.Sheets[sheetName]

  const XLSX   = await import('xlsx')
  const rows   = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: '',
    raw:    false,
  })

  if (rows.length === 0) {
    warnings.push('Excel 文件为空或无法读取')
    return { questions: [], warnings, sheetName }
  }

  // 规范化列名
  const firstRow = rows[0]
  const colMap: Record<string, string> = {}
  for (const rawKey of Object.keys(firstRow)) {
    colMap[rawKey] = normalizeHeader(rawKey)
  }

  const hasOptions = Object.values(colMap).includes('optionA')
  const hasAnswer  = Object.values(colMap).includes('answer')
  const hasContent = Object.values(colMap).includes('content')

  if (!hasContent) {
    warnings.push('未找到题目列（尝试列名：题目/题干/question），请检查表头')
    return { questions: [], warnings, sheetName }
  }

  if (!hasAnswer) {
    warnings.push('未找到答案列，答案将为空')
  }

  // 逐行解析
  const questions: ParsedQuestion[] = []

  rows.forEach((row, idx) => {
    // 反转列映射：normalizedName → rawValue
    const get = (field: string): string => {
      const rawKey = Object.entries(colMap).find(([, v]) => v === field)?.[0]
      return rawKey ? String(row[rawKey] ?? '').trim() : ''
    }

    const content = get('content')
    if (!content || content.length < 3) return  // 跳过空行

    const no = get('no') || String(idx + 1)

    // 组装选项
    const options: string[] = []
    for (const letter of ['A', 'B', 'C', 'D']) {
      const text = get(`option${letter}`)
      if (text) options.push(`${letter}.${text}`)
    }

    // 如果没有独立选项列，尝试从题目正文里提取
    if (options.length === 0 && content.includes('A.')) {
      const extracted = extractOptionsFromContent(content)
      options.push(...extracted.options)
    }

    const answer   = normalizeAnswer(get('answer'))
    const type     = get('type') || guessTypeFromText(content)
    const analysis = get('analysis')

    questions.push({
      no,
      content: cleanContent(content),
      options,
      answer,
      type,
      analysis,
      rawText: JSON.stringify(row),
    })
  })

  if (questions.length === 0) {
    warnings.push('解析后无有效题目，请检查文件格式')
  }

  return { questions, warnings, sheetName }
}

// ============================================================
// 辅助函数
// ============================================================

// 从题目正文中提取选项（部分格式把选项写在题目里）
function extractOptionsFromContent(text: string): { content: string; options: string[] } {
  const options: string[] = []
  const optionPattern = /([ABCD])[.．、\s]([^ABCD\n]{2,50})/g
  let match
  let cleanText = text

  while ((match = optionPattern.exec(text)) !== null) {
    options.push(`${match[1]}.${match[2].trim()}`)
    cleanText = cleanText.replace(match[0], '')
  }

  return { content: cleanText.trim(), options }
}

// 清理题目正文（去掉题号前缀等）
function cleanContent(text: string): string {
  return text
    .replace(/^\d{1,3}[.、．。\s]+/, '')
    .replace(/[A-D][.、．]\s*[^\n]{2,50}/g, '')  // 去掉混在题目里的选项
    .trim()
}

// 标准化答案（处理 "A" "（A）" "a" "1" 等各种格式）
function normalizeAnswer(raw: string): string {
  if (!raw) return ''
  const upper = raw.toUpperCase().replace(/[（(）)\s]/g, '')
  // 数字答案（1=A, 2=B...）
  if (/^\d$/.test(upper)) {
    return String.fromCharCode(64 + parseInt(upper))
  }
  // 取第一个 ABCD 字母
  const match = upper.match(/[ABCD]/)
  return match?.[0] ?? ''
}

function guessTypeFromText(text: string): string {
  const TYPE_KEYWORDS: Array<{ type: string; keywords: string[] }> = [
    { type: '资料分析',  keywords: ['增长', '比重', '图表', '万元', '亿元'] },
    { type: '数量关系',  keywords: ['甲乙', '工程量', '速度', '方程', '概率', '排列组合'] },
    { type: '常识判断',  keywords: ['法律', '宪法', '历史', '地理', '物理', '化学'] },
    { type: '言语理解',  keywords: ['文段', '作者', '填入', '排序', '下列表述'] },
    { type: '判断推理',  keywords: ['所有', '有些', '如果', '假设', '结论', '强化', '削弱'] },
  ]
  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (keywords.some(k => text.includes(k))) return type
  }
  return '判断推理'
}
