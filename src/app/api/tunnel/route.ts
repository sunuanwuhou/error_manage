import { exec, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { promisify } from 'util'

import { authOptions } from '@/lib/auth'
import {
  clearRuntimePublicOrigin,
  clearTunnelUrl,
  getPublicOriginState,
  getRuntimeDir,
  readTunnelUrl,
  syncNextAuthUrlFromRuntime,
  writeRuntimePublicOrigin,
  writeTunnelUrl,
} from '@/lib/runtime-public-url'

const execAsync = promisify(exec)
const RUNTIME_DIR = getRuntimeDir()
const PID_FILE = path.join(RUNTIME_DIR, 'tunnel.pid')
const CLOUDFLARED_DIR = path.join(RUNTIME_DIR, 'cloudflared')
const DOWNLOADED_CLOUDFLARED = path.join(CLOUDFLARED_DIR, 'cloudflared')
const LOCAL_TARGET_URL = 'http://localhost:3000'

type TunnelBinarySource = 'system' | 'downloaded'

function getDownloadedBinaryPath() {
  try {
    if (fs.existsSync(DOWNLOADED_CLOUDFLARED)) {
      fs.chmodSync(DOWNLOADED_CLOUDFLARED, 0o755)
      return DOWNLOADED_CLOUDFLARED
    }
  } catch {}
  return null
}

function getCloudflaredDownload() {
  const platform = os.platform()
  const arch = os.arch()

  if (platform === 'darwin' && arch === 'arm64') {
    return {
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz',
      archiveName: 'cloudflared-darwin-arm64.tgz',
      archiveType: 'tgz' as const,
    }
  }

  if (platform === 'darwin' && arch === 'x64') {
    return {
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz',
      archiveName: 'cloudflared-darwin-amd64.tgz',
      archiveType: 'tgz' as const,
    }
  }

  if (platform === 'linux' && arch === 'arm64') {
    return {
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64',
      archiveName: 'cloudflared-linux-arm64',
      archiveType: 'raw' as const,
    }
  }

  if (platform === 'linux' && (arch === 'x64' || arch === 'amd64')) {
    return {
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
      archiveName: 'cloudflared-linux-amd64',
      archiveType: 'raw' as const,
    }
  }

  return null
}

async function downloadToFile(url: string, filePath: string) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`)
  }

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })

  const tempPath = `${filePath}.tmp`
  const fileStream = fs.createWriteStream(tempPath)

  await new Promise<void>((resolve, reject) => {
    const body = res.body as unknown as NodeJS.ReadableStream
    body.pipe(fileStream)
    body.on('error', reject)
    fileStream.on('error', reject)
    fileStream.on('finish', resolve)
  })

  await fs.promises.rename(tempPath, filePath)
}

async function ensureBundledCloudflared() {
  const existing = getDownloadedBinaryPath()
  if (existing) return existing

  const download = getCloudflaredDownload()
  if (!download) {
    throw new Error(`automatic cloudflared download is not supported on ${os.platform()} ${os.arch()}`)
  }

  await fs.promises.mkdir(CLOUDFLARED_DIR, { recursive: true })
  const archivePath = path.join(CLOUDFLARED_DIR, download.archiveName)

  await downloadToFile(download.url, archivePath)

  if (download.archiveType === 'tgz') {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', ['-xzf', archivePath, '-C', CLOUDFLARED_DIR], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })

      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr || `tar extract failed: code=${code}`))
      })
    })
  } else {
    await fs.promises.rename(archivePath, DOWNLOADED_CLOUDFLARED)
  }

  await fs.promises.chmod(DOWNLOADED_CLOUDFLARED, 0o755)
  return DOWNLOADED_CLOUDFLARED
}

async function resolveCloudflaredBinary(): Promise<{ path: string; source: TunnelBinarySource }> {
  try {
    const locator = process.platform === 'win32' ? 'where cloudflared' : 'which cloudflared'
    const { stdout } = await execAsync(locator)
    const binaryPath = stdout.split(/\r?\n/).map(item => item.trim()).find(Boolean)
    if (binaryPath) return { path: binaryPath, source: 'system' }
  } catch {}

  const downloaded = getDownloadedBinaryPath()
  if (downloaded) return { path: downloaded, source: 'downloaded' }

  return { path: await ensureBundledCloudflared(), source: 'downloaded' }
}

function getPublicOriginAdvice() {
  const state = getPublicOriginState()
  const usingExternalOrigin = Boolean(
    state.effectivePublicOrigin && state.effectivePublicOrigin !== LOCAL_TARGET_URL,
  )

  return {
    nextAuthUrl: state.configuredNextAuthUrl,
    publicOrigin: state.effectivePublicOrigin,
    publicOriginSource: state.publicOriginSource,
    nextAuthMatchesTunnel: state.nextAuthMatchesEffectiveOrigin,
    publicAuthActive: Boolean(state.tunnelUrl && usingExternalOrigin),
    nextAuthWarning: state.tunnelUrl && !usingExternalOrigin
      ? 'Tunnel is running, but auth callbacks are still not using the public origin.'
      : null,
  }
}

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  if ((session.user as { role?: string }).role !== 'admin') return null
  return session
}

function readPid(): number | null {
  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
      return Number.isNaN(pid) ? null : pid
    }
  } catch {}
  return null
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function clearPidFile() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE)
  } catch {}
}

export async function GET() {
  if (!await requireAdmin()) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  syncNextAuthUrlFromRuntime()

  const pid = readPid()
  const running = pid ? isProcessRunning(pid) : false
  if (!running) clearPidFile()

  return NextResponse.json({
    running,
    url: running ? readTunnelUrl() : null,
    pid: running ? pid : null,
    autoDownloadSupported: Boolean(getCloudflaredDownload()),
    ...getPublicOriginAdvice(),
  })
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { action } = await req.json()

  if (action === 'stop') {
    const pid = readPid()
    if (pid && isProcessRunning(pid)) {
      try {
        process.kill(pid, 'SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 500))
        if (isProcessRunning(pid)) process.kill(pid, 'SIGKILL')
      } catch {}
    }

    clearPidFile()
    clearTunnelUrl()
    clearRuntimePublicOrigin()
    return NextResponse.json({ ok: true, running: false, ...getPublicOriginAdvice() })
  }

  if (action !== 'start') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

  const oldPid = readPid()
  if (oldPid && isProcessRunning(oldPid)) {
    try {
      process.kill(oldPid, 'SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch {}
  }

  clearPidFile()
  clearTunnelUrl()
  clearRuntimePublicOrigin()

  let binary: { path: string; source: TunnelBinarySource }
  try {
    binary = await resolveCloudflaredBinary()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cloudflared setup failed'
    return NextResponse.json(
      {
        error: `cloudflared is unavailable: ${message}`,
        hint: 'Install cloudflared manually, or let the project download the official binary on supported platforms.',
      },
      { status: 400 },
    )
  }

  return new Promise<NextResponse>((resolve) => {
    const child = spawn(binary.path, ['tunnel', '--url', LOCAL_TARGET_URL], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.unref()
    fs.mkdirSync(RUNTIME_DIR, { recursive: true })
    fs.writeFileSync(PID_FILE, String(child.pid))

    let settled = false
    const finish = (response: NextResponse) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(response)
    }

    const timeout = setTimeout(() => {
      finish(NextResponse.json({ error: 'cloudflared start timed out' }, { status: 500 }))
    }, 20_000)

    const onData = (data: Buffer) => {
      const text = data.toString()
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (!match) return

      const url = match[0]
      const publicOrigin = writeRuntimePublicOrigin(url)
      writeTunnelUrl(url)
      if (publicOrigin) {
        process.env.NEXTAUTH_URL = publicOrigin
      }

      finish(
        NextResponse.json({
          ok: true,
          running: true,
          url,
          pid: child.pid,
          binarySource: binary.source,
          autoDownloadSupported: Boolean(getCloudflaredDownload()),
          ...getPublicOriginAdvice(),
        }),
      )
    }

    child.stderr?.on('data', onData)
    child.stdout?.on('data', onData)

    child.on('error', (error) => {
      clearPidFile()
      finish(NextResponse.json({ error: `cloudflared failed to start: ${error.message}` }, { status: 500 }))
    })

    child.on('exit', (code) => {
      clearPidFile()
      if (!settled) {
        finish(NextResponse.json({ error: `cloudflared exited early: code=${code}` }, { status: 500 }))
      }
    })
  })
}
