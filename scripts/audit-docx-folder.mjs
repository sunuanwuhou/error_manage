import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function walkDocxFiles(rootDir) {
  const files = []
  const queue = [rootDir]
  while (queue.length > 0) {
    const current = queue.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) queue.push(fullPath)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) files.push(fullPath)
    }
  }
  return files.sort((a, b) => a.localeCompare(b))
}

function main() {
  const folder = process.argv[2]
  if (!folder) throw new Error('missing folder path')
  if (!fs.existsSync(folder)) throw new Error(`folder not found: ${folder}`)

  const files = walkDocxFiles(folder)
  const summary = []

  for (const file of files) {
    const result = spawnSync('node', ['scripts/audit-docx-paper.mjs', file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      shell: process.platform === 'win32',
    })

    if (result.status !== 0) {
      summary.push({ file, status: 'failed', error: result.stderr || result.stdout || 'unknown error' })
      continue
    }

    let parsed
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      summary.push({ file, status: 'failed', error: 'invalid json output' })
      continue
    }

    summary.push({
      file,
      status: 'ok',
      parsedTotal: parsed.parsedTotal,
      dbTotal: parsed.dbTotal,
      mismatchCount: parsed.mismatchCount,
      missingNos: parsed.noIntegrity?.db?.missingNos?.length ?? 0,
      duplicateNos: parsed.noIntegrity?.db?.duplicateNos?.length ?? 0,
      dbWithImage: parsed.completeness?.dbWithImage ?? 0,
      dbOptionsNonEmpty: parsed.completeness?.dbOptionsNonEmpty ?? 0,
      dbAnswerNonEmpty: parsed.completeness?.dbAnswerNonEmpty ?? 0,
    })
  }

  const totals = {
    files: summary.length,
    ok: summary.filter(item => item.status === 'ok').length,
    failed: summary.filter(item => item.status === 'failed').length,
    mismatchFiles: summary.filter(item => item.status === 'ok' && item.mismatchCount > 0).length,
  }

  console.log(JSON.stringify({ totals, summary }, null, 2))
}

main()
