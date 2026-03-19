'use client'
// src/components/layout/tunnel-widget.tsx
// Cloudflare Tunnel 控制面板 Widget
// 显示在管理员页面顶部，启动/停止隧道，固化显示当前域名

import { useEffect, useState, useCallback } from 'react'

interface TunnelStatus {
  running: boolean
  url: string | null
  pid: number | null
  binarySource?: 'system' | 'downloaded'
  nextAuthUrl?: string | null
  nextAuthMatchesTunnel?: boolean
  nextAuthWarning?: string | null
  autoDownloadSupported?: boolean
}

export function TunnelWidget() {
  const [status, setStatus]   = useState<TunnelStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/tunnel')
      if (res.ok) setStatus(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchStatus()
    // 隧道启动中时每3秒轮询
    const timer = setInterval(fetchStatus, 5000)
    return () => clearInterval(timer)
  }, [fetchStatus])

  async function handleStart() {
    setLoading(true)
    try {
      const res  = await fetch('/api/tunnel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'start' }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error + (data.hint ? `\n\n安装方式：\n${data.hint}` : ''))
      } else {
        setStatus(data)
      }
    } catch {
      alert('启动失败，请检查网络')
    } finally {
      setLoading(false)
    }
  }

  async function handleStop() {
    setLoading(true)
    try {
      await fetch('/api/tunnel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'stop' }),
      })
      setStatus({
        running: false,
        url: null,
        pid: null,
        nextAuthUrl: status?.nextAuthUrl ?? null,
        nextAuthMatchesTunnel: true,
        nextAuthWarning: null,
        autoDownloadSupported: status?.autoDownloadSupported,
      })
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
    <div className={`rounded-2xl border p-4 mb-5 transition-colors
      ${status?.running
        ? 'bg-green-50 border-green-200'
        : 'bg-gray-50 border-gray-200'}`}>

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status?.running ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          <span className="text-sm font-semibold text-gray-700">Cloudflare Tunnel</span>
          {status?.running && (
            <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">运行中</span>
          )}
        </div>

        <button
          onClick={status?.running ? handleStop : handleStart}
          disabled={loading}
          className={`text-sm px-4 py-1.5 rounded-xl font-medium min-h-[36px] transition-colors disabled:opacity-50
            ${status?.running
              ? 'bg-red-100 text-red-600 hover:bg-red-200'
              : 'bg-blue-600 text-white hover:bg-blue-700'}`}
        >
          {loading ? '处理中...' : status?.running ? '停止' : '启动'}
        </button>
      </div>

      {/* 域名显示区 */}
      {status?.running && status.url ? (
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 bg-white rounded-xl border border-green-200 px-3 py-2 overflow-hidden">
            <p className="text-xs text-gray-400 mb-0.5">外网访问地址</p>
            <p className="text-sm font-mono text-blue-600 truncate">{status.url}</p>
          </div>
          <button
            onClick={copyUrl}
            className="px-3 py-2 bg-white border border-green-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 min-h-[52px] flex-shrink-0"
          >
            {copied ? '✓' : '复制'}
          </button>
        </div>
      ) : !status?.running ? (
        <div>
          <p className="text-xs text-gray-400 mt-1">
            启动后获得 trycloudflare.com 随机域名，手机可直接访问
          </p>
          {status?.autoDownloadSupported ? (
            <p className="text-xs text-gray-400 mt-0.5">
              未安装 <code className="bg-gray-100 px-1 rounded">cloudflared</code> 时，管理员页会尝试自动下载官方二进制。
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5">
              ⚠️ 当前平台不支持自动下载时，需先安装：<code className="bg-gray-100 px-1 rounded">brew install cloudflared</code>
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400 mt-1 animate-pulse">正在启动，等待域名分配...</p>
      )}

      {status?.running && status.nextAuthWarning && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-700 leading-5">{status.nextAuthWarning}</p>
          {status.nextAuthUrl && (
            <p className="text-xs text-amber-700 mt-1">
              当前配置：<code className="bg-amber-100 px-1 rounded">{status.nextAuthUrl}</code>
            </p>
          )}
        </div>
      )}

      {/* 提示：每次重启域名会变 */}
      {status?.running && (
        <p className="text-xs text-gray-400 mt-2">
          ⚠️ 每次重启域名会变化，仅用于测试。{status.binarySource === 'downloaded' ? '本次使用的是自动下载的 cloudflared。' : ''} 固定域名需升级 Cloudflare Zero Trust。
        </p>
      )}
    </div>
  )
}
