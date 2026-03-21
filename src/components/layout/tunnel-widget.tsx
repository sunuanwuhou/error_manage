'use client'

import { useCallback, useEffect, useState } from 'react'

interface TunnelStatus {
  running: boolean
  url: string | null
  pid: number | null
  binarySource?: 'system' | 'downloaded'
  nextAuthUrl?: string | null
  publicOrigin?: string | null
  publicOriginSource?: 'runtime' | 'tunnel' | 'env' | null
  publicAuthActive?: boolean
  nextAuthMatchesTunnel?: boolean
  nextAuthWarning?: string | null
  autoDownloadSupported?: boolean
}

export function TunnelWidget() {
  const [status, setStatus] = useState<TunnelStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/tunnel')
      if (res.ok) setStatus(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, 5000)
    return () => clearInterval(timer)
  }, [fetchStatus])

  async function handleStart() {
    setLoading(true)
    try {
      const res = await fetch('/api/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error + (data.hint ? `\n\n${data.hint}` : ''))
      } else {
        setStatus(data)
      }
    } catch {
      alert('启动失败，请检查网络和 cloudflared 状态')
    } finally {
      setLoading(false)
    }
  }

  async function handleStop() {
    setLoading(true)
    try {
      const res = await fetch('/api/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
      if (res.ok) {
        setStatus(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }

  async function copyUrl() {
    if (!status?.url) return
    await navigator.clipboard.writeText(status.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={`mb-5 rounded-2xl border p-4 transition-colors ${
        status?.running ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${status?.running ? 'animate-pulse bg-green-500' : 'bg-gray-300'}`} />
          <span className="text-sm font-semibold text-gray-700">Cloudflare Tunnel</span>
          {status?.running && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-600">运行中</span>
          )}
        </div>

        <button
          onClick={status?.running ? handleStop : handleStart}
          disabled={loading}
          className={`min-h-[36px] rounded-xl px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
            status?.running ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {loading ? '处理中...' : status?.running ? '停止' : '启动'}
        </button>
      </div>

      {status?.running && status.url ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 overflow-hidden rounded-xl border border-green-200 bg-white px-3 py-2">
            <p className="mb-0.5 text-xs text-gray-400">外网访问地址</p>
            <p className="truncate font-mono text-sm text-blue-600">{status.url}</p>
          </div>
          <button
            onClick={copyUrl}
            className="min-h-[52px] flex-shrink-0 rounded-xl border border-green-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      ) : !status?.running ? (
        <div>
          <p className="mt-1 text-xs text-gray-400">启动后会拿到一个 `trycloudflare.com` 外网地址，手机可直接访问。</p>
          {status?.autoDownloadSupported ? (
            <p className="mt-0.5 text-xs text-gray-400">
              未安装 <code className="rounded bg-gray-100 px-1">cloudflared</code> 时，项目会尝试自动下载官方二进制。
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-gray-400">
              当前平台不支持自动下载时，需要先手动安装 <code className="rounded bg-gray-100 px-1">cloudflared</code>。
            </p>
          )}
        </div>
      ) : (
        <p className="mt-1 animate-pulse text-xs text-gray-400">正在启动，等待域名分配...</p>
      )}

      {status?.running && status.publicOrigin && (
        <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
          <p className="text-xs text-blue-700">当前认证回调基地址</p>
          <p className="mt-1 break-all font-mono text-sm text-blue-700">{status.publicOrigin}</p>
        </div>
      )}

      {status?.running && status.nextAuthWarning && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs leading-5 text-amber-700">{status.nextAuthWarning}</p>
          {status.nextAuthUrl && (
            <p className="mt-1 text-xs text-amber-700">
              当前 `.env.local` 为 <code className="rounded bg-amber-100 px-1">{status.nextAuthUrl}</code>
            </p>
          )}
        </div>
      )}

      {status?.running && (
        <p className="mt-2 text-xs text-gray-400">
          每次重启 Quick Tunnel 域名都会变化，仅适合测试。
          {status.binarySource === 'downloaded' ? ' 当前使用的是项目自动下载的 cloudflared。' : ''}
          {status.publicAuthActive ? ' 当前认证回调也已切到外网。' : ' 固定域名仍建议切到 Named Tunnel。'}
        </p>
      )}
    </div>
  )
}
