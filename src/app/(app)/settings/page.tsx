'use client'
// src/app/(app)/settings/page.tsx

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const IMPORT_PREFS_KEY = 'pref_import_settings_v2'

interface OnboardingConfig {
  completed?: boolean
  examType: 'guo_kao' | 'sheng_kao' | 'tong_kao'
  targetProvince?: string | null
  targetScore: number
  examDate?: string | null
  dailyGoal: number
}

export default function SettingsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const username = (session?.user as any)?.name ?? ''

  // 密码修改
  const [pwForm, setPwForm]   = useState({ current: '', next: '', confirm: '' })
  const [pwMsg, setPwMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [pwLoading, setPwLoading] = useState(false)

  // 考试配置
  const [config, setConfig]   = useState<OnboardingConfig | null>(null)
  const [cfgMsg, setCfgMsg]   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [cfgLoading, setCfgLoading] = useState(false)
  const [showConfigDetail, setShowConfigDetail] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/onboarding')
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? '配置加载失败')
        setConfig(data)
      })
      .catch((e: any) => setCfgMsg({ type: 'err', text: e?.message ?? '配置加载失败' }))
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
    if (!config) return
    setCfgLoading(true); setCfgMsg(null)
    const res = await fetch('/api/onboarding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        examType:      config.examType,
        targetScore:   config.targetScore,
        examDate:      config.examDate?.split('T')[0],
        dailyGoal:     config.dailyGoal,
        targetProvince: config.examType === 'sheng_kao' ? (config.targetProvince || undefined) : undefined,
      }),
    })
    setCfgLoading(false)
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setConfig(current => current ? { ...current, completed: true } : current)
      try {
        const raw = localStorage.getItem(IMPORT_PREFS_KEY)
        const saved = raw ? JSON.parse(raw) : {}
        localStorage.setItem(IMPORT_PREFS_KEY, JSON.stringify({
          ...saved,
          srcProvince: config.examType === 'sheng_kao' ? (config.targetProvince || '') : '',
        }))
      } catch {}
      setCfgMsg({ type: 'ok', text: '保存成功' })
    } else {
      setCfgMsg({ type: 'err', text: data.error ?? '保存失败' })
    }
  }

  async function handleExportData() {
    setExporting(true)
    setExportMsg(null)
    try {
      const res = await fetch('/api/export/data')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? '导出失败')
      }

      const blob = await res.blob()
      const contentDisposition = res.headers.get('Content-Disposition') ?? ''
      const matched = contentDisposition.match(/filename="(.+?)"/)
      const filename = matched?.[1] ?? `error_manage_export_${new Date().toISOString().slice(0, 10)}.json`
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
      setExportMsg({ type: 'ok', text: '导出已开始，文件会保存到你的下载目录。' })
    } catch (e: any) {
      setExportMsg({ type: 'err', text: e?.message ?? '导出失败' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-8 space-y-6">
      <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">设置</h1>
      <p className="text-xs text-gray-400 -mt-4">
        这里只保留完整账号与备考配置；其他页面只读取摘要，不再反复打扰。
      </p>

      {/* 用户信息 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 lg:p-5">
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

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 lg:p-5">
        <h2 className="font-semibold text-gray-900 mb-3">其他功能</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <Link href="/notes" className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">笔记</Link>
          <Link href="/papers" className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">套卷</Link>
          {(session?.user as any)?.role === 'admin' && (
            <Link href="/admin/users" className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">管理后台</Link>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 lg:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold text-gray-900">数据导出</h2>
            <p className="text-xs text-gray-400 mt-1">导出用户配置、错题、复习记录、套卷会话、导入、分析轨迹和笔记，方便备份与迁移。</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExportData}
          disabled={exporting}
          className="w-full py-3 bg-gray-900 text-white font-bold rounded-xl disabled:opacity-50"
        >
          {exporting ? '导出中...' : '导出我的数据（JSON）'}
        </button>
        {exportMsg && (
          <p className={`mt-3 text-sm ${exportMsg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{exportMsg.text}</p>
        )}
      </div>

      {/* 考试配置 */}
      {config && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 lg:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">备考配置</h2>
              <p className="text-xs text-gray-400 mt-1">
                默认只看摘要，点“修改”才展开完整配置。
              </p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${config.completed ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
              {config.completed ? '已完成' : '未完成'}
            </span>
          </div>
          <div className="mt-4 rounded-2xl bg-gray-50 border border-gray-100 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {config.examType === 'guo_kao' ? '国考' : config.examType === 'sheng_kao' ? '省考' : '统考'}
                  {config.targetProvince ? ` · ${config.targetProvince}` : ''}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  目标分 {config.targetScore} · 每日 {config.dailyGoal} 题
                  {config.examDate ? ` · ${config.examDate.split('T')[0]}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConfigDetail(v => !v)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600"
              >
                {showConfigDetail ? '收起' : '修改'}
              </button>
            </div>
          </div>
          {showConfigDetail && (
            <form onSubmit={handleCfgSubmit} className="space-y-3 mt-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
              {config.examType === 'sheng_kao' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">目标省份</label>
                  <input value={config.targetProvince ?? ''}
                    onChange={e => setConfig((c: any) => ({ ...c, targetProvince: e.target.value }))}
                    placeholder="如：浙江"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              )}
              {cfgMsg && <p className={`text-sm ${cfgMsg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{cfgMsg.text}</p>}
              <button type="submit" disabled={cfgLoading}
                className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl disabled:opacity-50">
                {cfgLoading ? '保存中...' : '保存配置'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* 密码修改 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 lg:p-5">
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
