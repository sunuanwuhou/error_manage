import { runPythonOCR } from '@/lib/ocr/python-runner'

export interface OCRQuestionResult {
  content: string
  options: string[]
  answer?: string
  analysis?: string
  type?: string
  rawText?: string
  lines?: string[]
}

export async function recognizeQuestionFromImage(file: File): Promise<OCRQuestionResult> {
  const payload = await runPythonOCR(file)
  const fullText = payload.full_text || (payload.lines || []).join('\n')
  return {
    content: payload.content || fullText,
    options: payload.options || [],
    answer: payload.answer || '',
    analysis: payload.analysis || '',
    type: payload.type || '单项选择题',
    rawText: fullText,
    lines: payload.lines || [],
  }
}
