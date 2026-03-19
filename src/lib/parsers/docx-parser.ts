// src/lib/parsers/docx-parser.ts
// ============================================================
// DOCX 真题解析器
// 使用 mammoth 提取原始文本，再复用 PDF 解析逻辑
// ============================================================

import mammoth from 'mammoth'
import { parsePdfText } from './pdf-parser'
import type { ParsedQuestion } from './pdf-parser'

export async function parseDocxBuffer(buffer: Buffer): Promise<{
  questions: ParsedQuestion[]
  warnings: string[]
}> {
  const warnings: string[] = []

  const { value } = await mammoth.extractRawText({ buffer })
  const rawText = String(value || '').trim()

  if (!rawText) {
    warnings.push('DOCX 文件为空或未提取到文本')
    return { questions: [], warnings }
  }

  const parsed = parsePdfText(rawText)
  const questions = parsed.questions.map((q) => {
    const answerMatch = q.rawText.match(/正确答案[:：]\s*([ABCD])/)
    const pointMatch = q.rawText.match(/考点[:：]\s*([^\n]+)/)

    const cleanedContent = q.content
      .replace(/\s*正确答案[:：]\s*[ABCD][^\n]*/g, '')
      .replace(/\s*考点[:：]\s*[^\n]*/g, '')
      .replace(/\s*自定义备注[:：]\s*[^\n]*/g, '')
      .replace(/\s*-{5,}\s*$/g, '')
      .trim()

    return {
      ...q,
      content: cleanedContent,
      answer: q.answer || answerMatch?.[1] || '',
      type: pointMatch?.[1]?.includes('常识') ? '常识判断' : q.type,
    }
  })

  return {
    questions,
    warnings: [...warnings, ...parsed.warnings],
  }
}
