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

const execAsync   = promisify(exec)
const TUNNEL_FILE = path.join(process.cwd(), '.tunnel-url')  // 存储当前隧道URL
const PID_FILE    = path.join(process.cwd(), '.tunnel-pid')  // 存储 cloudflared PID

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

  // 进程不在但文件还在，清理
  if (!running && pid) {
    try { fs.unlinkSync(PID_FILE) } catch {}
  }

  return NextResponse.json({ running, url: running ? url : null, pid: running ? pid : null })
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

    // 检查 cloudflared 是否已安装
    try {
      await execAsync('which cloudflared')
    } catch {
      return NextResponse.json({
        error: 'cloudflared 未安装',
        hint:  'Mac: brew install cloudflared\nLinux: 见 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
      }, { status: 400 })
    }

    // 启动 cloudflared，监听 stderr 获取随机域名
    return new Promise<NextResponse>((resolve) => {
      const child = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3000'], {
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
          resolve(NextResponse.json({ ok: true, running: true, url, pid: child.pid }))
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
