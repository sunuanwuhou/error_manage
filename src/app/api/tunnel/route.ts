// src/app/api/tunnel/route.ts
// Cloudflare Tunnel 管理 API
// 启动 cloudflared，捕获随机域名，存入 .tunnel-url 文件

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import os from 'os'

const execAsync   = promisify(exec)
const TUNNEL_FILE = path.join(process.cwd(), '.tunnel-url')  // 存储当前隧道URL
const PID_FILE    = path.join(process.cwd(), '.tunnel-pid')  // 存储 cloudflared PID
const RUNTIME_DIR = path.join(process.cwd(), '.runtime')
const CLOUDFLARED_DIR = path.join(RUNTIME_DIR, 'cloudflared')
const DOWNLOADED_CLOUDFLARED = path.join(CLOUDFLARED_DIR, 'cloudflared')

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
      targetName: 'cloudflared',
    }
  }

  if (platform === 'darwin' && arch === 'x64') {
    return {
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz',
      archiveName: 'cloudflared-darwin-amd64.tgz',
      archiveType: 'tgz' as const,
      targetName: 'cloudflared',
    }
  }

  if (platform === 'linux' && arch === 'arm64') {
    return {
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64',
      archiveName: 'cloudflared-linux-arm64',
      archiveType: 'raw' as const,
      targetName: 'cloudflared',
    }
  }

  if (platform === 'linux' && (arch === 'x64' || arch === 'amd64')) {
    return {
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
      archiveName: 'cloudflared-linux-amd64',
      archiveType: 'raw' as const,
      targetName: 'cloudflared',
    }
  }

  return null
}

async function downloadToFile(url: string, filePath: string) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`下载失败：HTTP ${res.status}`)
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
    throw new Error(`当前系统暂不支持自动下载 cloudflared：${os.platform()} ${os.arch()}`)
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
        else reject(new Error(stderr || `tar 解压失败，code=${code}`))
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
    const { stdout } = await execAsync('which cloudflared')
    const binaryPath = stdout.trim()
    if (binaryPath) return { path: binaryPath, source: 'system' }
  } catch {}

  const downloaded = getDownloadedBinaryPath()
  if (downloaded) return { path: downloaded, source: 'downloaded' }

  return { path: await ensureBundledCloudflared(), source: 'downloaded' }
}

function getNextAuthAdvice(url: string | null) {
  const configured = process.env.NEXTAUTH_URL?.trim() || null
  const normalizedConfigured = configured?.replace(/\/$/, '') || null
  const normalizedTunnel = url?.replace(/\/$/, '') || null

  if (!normalizedTunnel) {
    return {
      nextAuthUrl: normalizedConfigured,
      nextAuthMatchesTunnel: true,
      nextAuthWarning: null,
    }
  }

  const matches = normalizedConfigured === normalizedTunnel
  return {
    nextAuthUrl: normalizedConfigured,
    nextAuthMatchesTunnel: matches,
    nextAuthWarning: matches
      ? null
      : '当前 NEXTAUTH_URL 和临时外网域名不一致，外网登录回调可能跳回 localhost。若需稳定外网登录，请把 .env.local 中的 NEXTAUTH_URL 改成当前 tunnel 地址后重启开发服务。',
  }
}

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  if ((session.user as any).role !== 'admin') return null
  return session
}

function readTunnelUrl(): string | null {
  try {
    if (fs.existsSync(TUNNEL_FILE)) {
      return fs.readFileSync(TUNNEL_FILE, 'utf-8').trim() || null
    }
  } catch {}
  return null
}

function readPid(): number | null {
  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim())
      return isNaN(pid) ? null : pid
    }
  } catch {}
  return null
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)  // signal 0 = check if process exists
    return true
  } catch {
    return false
  }
}

// GET — 查询隧道状态
export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: '无权限' }, { status: 403 })

  const url = readTunnelUrl()
  const pid = readPid()
  const running = pid ? isProcessRunning(pid) : false
  const nextAuth = getNextAuthAdvice(running ? url : null)

  // 进程不在但文件还在，清理
  if (!running && pid) {
    try { fs.unlinkSync(PID_FILE) } catch {}
  }

  return NextResponse.json({
    running,
    url: running ? url : null,
    pid: running ? pid : null,
    ...nextAuth,
    autoDownloadSupported: !!getCloudflaredDownload(),
  })
}

// POST — 启动或停止隧道
export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: '无权限' }, { status: 403 })

  const { action } = await req.json()

  if (action === 'stop') {
    const pid = readPid()
    if (pid && isProcessRunning(pid)) {
      try {
        process.kill(pid, 'SIGTERM')
        await new Promise(r => setTimeout(r, 500))
        if (isProcessRunning(pid)) process.kill(pid, 'SIGKILL')
      } catch {}
    }
    try { fs.unlinkSync(PID_FILE) }  catch {}
    try { fs.unlinkSync(TUNNEL_FILE) } catch {}
    return NextResponse.json({ ok: true, running: false })
  }

  if (action === 'start') {
    // 先停掉旧的
    const oldPid = readPid()
    if (oldPid && isProcessRunning(oldPid)) {
      try { process.kill(oldPid, 'SIGTERM') } catch {}
      await new Promise(r => setTimeout(r, 500))
    }
    try { fs.unlinkSync(TUNNEL_FILE) } catch {}

    // 优先使用系统自带 cloudflared；没有时自动下载到项目运行目录
    let binary: { path: string; source: TunnelBinarySource }
    try {
      binary = await resolveCloudflaredBinary()
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动准备 cloudflared 失败'
      return NextResponse.json({
        error: `cloudflared 不可用：${message}`,
        hint:  '可手动安装 cloudflared；Mac 推荐 brew install cloudflared。若不安装，管理员页会尝试自动下载支持平台的官方二进制。',
      }, { status: 400 })
    }

    // 启动 cloudflared，监听 stderr 获取随机域名
    return new Promise<NextResponse>((resolve) => {
      const child = spawn(binary.path, ['tunnel', '--url', 'http://localhost:3000'], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      child.unref()
      fs.writeFileSync(PID_FILE, String(child.pid))

      let urlFound = false
      const timeout = setTimeout(() => {
        if (!urlFound) {
          resolve(NextResponse.json({ error: '启动超时，请检查 cloudflared 是否正常' }, { status: 500 }))
        }
      }, 20000)

      // cloudflared 把隧道 URL 输出到 stderr
      const onData = (data: Buffer) => {
        const text = data.toString()
        const match = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/)
        if (match && !urlFound) {
          urlFound = true
          clearTimeout(timeout)
          const url = match[0]
          fs.writeFileSync(TUNNEL_FILE, url)
          resolve(NextResponse.json({
            ok: true,
            running: true,
            url,
            pid: child.pid,
            binarySource: binary.source,
            autoDownloadSupported: !!getCloudflaredDownload(),
            ...getNextAuthAdvice(url),
          }))
        }
      }

      child.stderr?.on('data', onData)
      child.stdout?.on('data', onData)

      child.on('error', (err) => {
        clearTimeout(timeout)
        resolve(NextResponse.json({ error: `启动失败：${err.message}` }, { status: 500 }))
      })

      child.on('exit', (code) => {
        try { fs.unlinkSync(PID_FILE) } catch {}
        if (!urlFound) {
          clearTimeout(timeout)
          resolve(NextResponse.json({ error: `cloudflared 退出，code=${code}` }, { status: 500 }))
        }
      })
    })
  }

  return NextResponse.json({ error: '未知操作' }, { status: 400 })
}
