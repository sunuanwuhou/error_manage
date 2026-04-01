import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

export type ParsedQuestion = {
  no: string
  content: string
  questionImage?: string
  options: string[]
  answer: string
  type: string
  analysis?: string
  rawText?: string
  srcName?: string
  srcOrigin?: string
  examType?: string
}

export type ParseDocxResult = {
  questions: ParsedQuestion[]
  warnings: string[]
}

function runPython(scriptPath: string, docxPath: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('python3', [scriptPath, docxPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr || `docx parser exited with code ${code}`))
    })
  })
}

export async function parseDocxBuffer(buffer: Buffer): Promise<ParseDocxResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-import-'))
  const docxPath = path.join(tempDir, 'input.docx')
  const scriptPath = path.join(process.cwd(), 'scripts', 'docx_parser.py')
  try {
    await fs.writeFile(docxPath, buffer)
    const raw = await runPython(scriptPath, docxPath)
    const parsed = JSON.parse(raw || '{}')
    const questions = Array.isArray(parsed.questions) ? parsed.questions : []
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : []
    return {
      questions: questions.map((item: any, index: number) => ({
        no: String(item.no || index + 1),
        content: String(item.content || '').trim(),
        questionImage: item.questionImage || '',
        options: Array.isArray(item.options) ? item.options.map((v: any) => String(v || '').trim()).filter(Boolean) : [],
        answer: String(item.answer || '').trim(),
        type: String(item.type || '单项选择题').trim(),
        analysis: String(item.analysis || '').trim(),
        rawText: String(item.rawText || '').trim(),
      })),
      warnings,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
