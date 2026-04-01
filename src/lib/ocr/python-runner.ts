import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

export interface PythonOCRPayload {
  lines: string[]
  full_text: string
  captcha_mode_used?: boolean
  details?: Array<{ text: string; confidence?: number; box?: unknown }>
  content?: string
  options?: string[]
  answer?: string
  analysis?: string
  type?: string
}

function getPythonBin() {
  return process.env.OCR_PYTHON_BIN || 'python3'
}

function getRunnerPath() {
  return process.env.OCR_RUNNER_PATH || 'scripts/ocr_runner.py'
}

async function writeTempFile(file: File) {
  const ext = path.extname(file.name || '') || '.png'
  const tmpPath = path.join(os.tmpdir(), `em-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(tmpPath, buffer)
  return tmpPath
}

function execPython(imagePath: string): Promise<PythonOCRPayload> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getPythonBin(), [getRunnerPath(), imagePath], {
      cwd: process.cwd(),
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', chunk => { stdout += String(chunk) })
    proc.stderr.on('data', chunk => { stderr += String(chunk) })
    proc.on('error', reject)
    proc.on('close', () => {
      try {
        const parsed = JSON.parse(stdout.trim())
        if (!parsed.ok) return reject(new Error(parsed.error || stderr || 'OCR 失败'))
        resolve(parsed.data as PythonOCRPayload)
      } catch (error: any) {
        reject(new Error(`OCR 输出解析失败: ${error?.message || 'unknown'}\n${stdout}\n${stderr}`))
      }
    })
  })
}

export async function runPythonOCR(file: File) {
  const tmpPath = await writeTempFile(file)
  try {
    return await execPython(tmpPath)
  } finally {
    await fs.unlink(tmpPath).catch(() => {})
  }
}
