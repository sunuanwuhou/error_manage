import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const nextDir = path.join(process.cwd(), '.next')
const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')
const maxAttempts = 3

function cleanNextDir() {
  fs.rmSync(nextDir, { recursive: true, force: true })
}

function runBuildOnce() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [nextBin, 'build'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    })

    child.on('exit', (code, signal) => {
      resolve({ code, signal })
    })
  })
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  cleanNextDir()
  const result = await runBuildOnce()
  if (result.code === 0) {
    process.exit(0)
  }

  if (attempt === maxAttempts) {
    process.exit(result.code ?? 1)
  }

  await new Promise((resolve) => setTimeout(resolve, 1000))
}
