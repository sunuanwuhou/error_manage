import fs from 'node:fs/promises'
import path from 'node:path'

import { LoginForm } from './LoginForm'

async function readTunnelUrl() {
  try {
    const filePath = path.join(process.cwd(), '.runtime', 'tunnel-url.txt')
    const value = (await fs.readFile(filePath, 'utf8')).trim()
    return value || null
  } catch {
    return null
  }
}

export default async function LoginPage() {
  const tunnelUrl = await readTunnelUrl()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">错题管理系统</h1>
          <p className="text-sm text-gray-500 mt-1">公务员行测备考</p>
        </div>

        {tunnelUrl && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <div className="font-medium">当前外网地址</div>
            <a href={tunnelUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all underline underline-offset-2">
              {tunnelUrl}
            </a>
            <div className="mt-2 text-xs text-emerald-700">
              Quick Tunnel 每次重启都会变更域名；如需稳定外网登录，请把 NEXTAUTH_URL 固定到命名隧道域名。
            </div>
          </div>
        )}

        <LoginForm />

        <p className="text-center text-xs text-gray-400 mt-4">
          账号由管理员创建，如需帮助请联系管理员
        </p>
      </div>
    </div>
  )
}
