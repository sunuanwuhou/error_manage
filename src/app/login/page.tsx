import fs from 'node:fs/promises'

import { LoginForm } from './LoginForm'
import { getPublicOriginState, getTunnelUrlFilePath } from '@/lib/runtime-public-url'

async function readTunnelUrl() {
  try {
    const value = (await fs.readFile(getTunnelUrlFilePath(), 'utf8')).trim()
    return value || null
  } catch {
    return null
  }
}

export default async function LoginPage() {
  const tunnelUrl = await readTunnelUrl()
  const publicOriginState = getPublicOriginState()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">错题管理系统</h1>
          <p className="mt-1 text-sm text-gray-500">公务员行测备考</p>
        </div>

        {tunnelUrl && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <div className="font-medium">当前外网地址</div>
            <a href={tunnelUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all underline underline-offset-2">
              {tunnelUrl}
            </a>
            <div className="mt-2 text-xs text-emerald-700">
              {publicOriginState.publicOriginSource === 'runtime'
                ? '当前认证回调会优先使用这个外网地址。Quick Tunnel 重启后域名会变化。'
                : 'Quick Tunnel 每次重启都会变更域名；如需长期稳定外网登录，仍建议使用 Named Tunnel。'}
            </div>
          </div>
        )}

        <LoginForm />

        <p className="mt-4 text-center text-xs text-gray-400">账号由管理员创建，如需帮助请联系管理员</p>
      </div>
    </div>
  )
}
