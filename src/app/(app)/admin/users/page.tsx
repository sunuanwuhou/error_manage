'use client'
// src/app/(app)/admin/users/page.tsx

import { useEffect, useState } from 'react'
import { TunnelWidget } from '@/components/layout/tunnel-widget'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'

interface AdminUser {
  id: string
  username: string
  role: string
  isActive: boolean
  passwordExpireAt: string
  examType: string
  targetScore: number
  createdAt: string
  _count: { userErrors: number }
}

export default function AdminUsersPage() {
  const { data: session } = useSession()
  const router            = useRouter()
  const [users, setUsers]     = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  // 权限检查
  const role = (session?.user as any)?.role
  useEffect(() => {
    if (session && role !== 'admin') router.push('/dashboard')
  }, [session, role, router])

  function loadUsers() {
    fetch('/api/admin/users')
      .then(r => r.json())
      .then(data => { setUsers(data); setLoading(false) })
  }

  useEffect(() => { loadUsers() }, [])

  async function toggleActive(userId: string) {
    await fetch('/api/admin/users', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId, action: 'toggle_active' }),
    })
    loadUsers()
  }

  const now = new Date()

  if (role !== 'admin') return null

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4">
      <TunnelWidget />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">账号管理</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl font-medium min-h-[44px] flex items-center"
        >
          + 新建账号
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {users.map(u => {
            const expired = new Date(u.passwordExpireAt) < now
            const expireSoon = !expired && (new Date(u.passwordExpireAt).getTime() - now.getTime()) < 7 * 86400000

            return (
              <div key={u.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{u.username}</span>
                      {u.role === 'admin' && (
                        <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">管理员</span>
                      )}
                      {!u.isActive && (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">已停用</span>
                      )}
                      {expired && (
                        <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">已过期</span>
                      )}
                      {expireSoon && (
                        <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full">即将过期</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1 space-x-3">
                      <span>错题 {u._count.userErrors} 道</span>
                      <span>密码到期：{format(new Date(u.passwordExpireAt), 'yyyy-MM-dd')}</span>
                      <span>注册：{format(new Date(u.createdAt), 'yyyy-MM-dd')}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleActive(u.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg min-h-[36px] border transition-colors
                      ${u.isActive
                        ? 'border-red-200 text-red-500 hover:bg-red-50'
                        : 'border-green-200 text-green-600 hover:bg-green-50'}`}
                  >
                    {u.isActive ? '停用' : '启用'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 创建账号弹窗 */}
      {showCreate && <CreateUserModal onClose={() => { setShowCreate(false); loadUsers() }} />}
    </div>
  )
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const [form, setForm]     = useState({ username: '', password: '', role: 'user', expireDays: 365 })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const res = await fetch('/api/admin/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) {
      onClose()
    } else {
      const data = await res.json()
      setError(data.error ?? '创建失败')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="font-bold text-lg text-gray-900 mb-4">新建账号</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="至少2个字符"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">初始密码</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="至少6个字符"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">有效天数</label>
              <input
                type="number"
                value={form.expireDays}
                onChange={e => setForm(f => ({ ...f, expireDays: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                min={1} max={3650}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-xl font-medium">
              取消
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold disabled:opacity-50">
              {saving ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
