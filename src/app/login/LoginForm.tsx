'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export function LoginForm() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await signIn('credentials', {
        username,
        password,
        redirect: false,
      })

      if (res?.error) {
        if (res.error === 'RateLimit') {
          setError('登录尝试过于频繁，请 15 分钟后再试')
          return
        }

        setError(res.error === 'CredentialsSignin' ? '用户名或密码错误' : res.error)
        return
      }

      router.push('/dashboard')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('Invalid URL')) {
        setError('登录请求被限流，请 15 分钟后重试')
        return
      }
      setError('登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
        <input
          data-testid="login-username"
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="w-full px-3 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="输入用户名"
          autoComplete="username"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
        <input
          data-testid="login-password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="输入密码"
          autoComplete="current-password"
          required
        />
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <button
        data-testid="login-submit"
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-base"
      >
        {loading ? '登录中...' : '登录'}
      </button>
    </form>
  )
}
