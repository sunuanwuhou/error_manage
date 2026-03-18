'use client'
// src/app/(app)/settings/page.tsx

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const username = (session?.user as any)?.name ?? ''

  // 密码修改
  const [pwForm, setPwForm]   = useState({ current: '', next: '', confirm: '' })
  const [pwMsg, setPwMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [pwLoading, setPwLoading] = useState(false)

  // 考试配置
  const [config, setConfig]   = useState<any>(null)
  const [cfgMsg, setCfgMsg]   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [cfgLoading, setCfgLoading] = useState(false)

  useEffect(() => {
    fetch('/api/onboarding').then(r => r.json()).then(setConfig)
  }, [])

  async function handlePwSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pwForm.next !== pwForm.confirm) { setPwMsg({ type: 'err', text: '两次新密码不一致' }); return }
    setPwLoading(true); setPwMsg(null)
    const res = await fetch('/api/settings/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    })
    setPwLoading(false)
    const data = await res.json()
    if (res.ok) { setPwMsg({ type: 'ok', text: '密码修改成功' }); setPwForm({ current: '', next: '', confirm: '' }) }
    else setPwMsg({ type: 'err', text: data.error ?? '修改失败' })
  }

  async function handleCfgSubmit(e: React.FormEvent) {
    e.preventDefault()
    setCfgLoading(true); setCfgMsg(null)
    const res = await fetch('/api/onboarding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        examType:      config.examType,
        targetScore:   config.targetScore,
        examDate:      config.examDate?.split('T')[0],
        dailyGoal:     config.dailyGoal,
        targetProvince: config.targetProvince,
      }),
    })
    setCfgLoading(false)
    setCfgMsg(res.ok ? { type: 'ok', text: '保存成功' } : { type: 'err', text: '保存失败' })
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">设置</h1>

      {/* 用户信息 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-lg">
            {username.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-gray-900">{username}</p>
            <p className="text-xs text-gray-400">{(session?.user as any)?.role === 'admin' ? '管理员' : '普通用户'}</p>
          </div>
        </div>
      </div>

      {/* 考试配置 */}
      {config && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-4">备考配置</h2>
          <form onSubmit={handleCfgSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">考试类型</label>
                <select value={config.examType} onChange={e => setConfig((c: any) => ({ ...c, examType: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="guo_kao">国考</option>
                  <option value="sheng_kao">省考</option>
                  <option value="tong_kao">统考</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">目标分</label>
                <input type="number" min={50} max={150} value={config.targetScore}
                  onChange={e => setConfig((c: any) => ({ ...c, targetScore: Number(e.target.value) }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">考试日期</label>
                <input type="date" value={config.examDate?.split('T')[0] ?? ''}
                  onChange={e => setConfig((c: any) => ({ ...c, examDate: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">每日目标题数</label>
                <select value={config.dailyGoal} onChange={e => setConfig((c: any) => ({ ...c, dailyGoal: Number(e.target.value) }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {[30, 50, 70, 100].map(n => <option key={n} value={n}>{n} 道</option>)}
                </select>
              </div>
            </div>
            {cfgMsg && <p className={`text-sm ${cfgMsg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{cfgMsg.text}</p>}
            <button type="submit" disabled={cfgLoading}
              className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl disabled:opacity-50">
              {cfgLoading ? '保存中...' : '保存配置'}
            </button>
          </form>
        </div>
      )}

      {/* 密码修改 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h2 className="font-semibold text-gray-900 mb-4">修改密码</h2>
        <form onSubmit={handlePwSubmit} className="space-y-3">
          {(['current', 'next', 'confirm'] as const).map((field, i) => (
            <div key={field}>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {['当前密码', '新密码（至少6位）', '确认新密码'][i]}
              </label>
              <input type="password" value={pwForm[field]}
                onChange={e => setPwForm(f => ({ ...f, [field]: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                required />
            </div>
          ))}
          {pwMsg && <p className={`text-sm ${pwMsg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{pwMsg.text}</p>}
          <button type="submit" disabled={pwLoading}
            className="w-full py-3 bg-gray-800 text-white font-bold rounded-xl disabled:opacity-50">
            {pwLoading ? '修改中...' : '修改密码'}
          </button>
        </form>
      </div>

      {/* 退出登录 */}
      <button onClick={() => signOut({ callbackUrl: '/login' })}
        className="w-full py-3 border border-red-200 text-red-500 font-medium rounded-2xl hover:bg-red-50 transition-colors">
        退出登录
      </button>
    </div>
  )
}
