// src/middleware.ts
// Next.js 中间件：登录接口限流 + 未登录重定向

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

// 内存限流（middleware 运行在 Edge Runtime，不能用 Node.js 模块，用简单计数）
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function checkLoginRateLimit(ip: string): boolean {
  const now    = Date.now()
  const window = 15 * 60 * 1000  // 15分钟
  const max    = 5

  const record = loginAttempts.get(ip)
  if (!record || record.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + window })
    return true
  }
  if (record.count >= max) return false
  record.count++
  return true
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 登录接口限流
  if (pathname === '/api/auth/callback/credentials' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            ?? req.headers.get('x-real-ip')
            ?? '127.0.0.1'

    if (!checkLoginRateLimit(ip)) {
      return NextResponse.json(
        { error: '登录尝试过于频繁，请 15 分钟后再试' },
        { status: 429 }
      )
    }
  }

  // 未登录访问 /api/*（除 auth 外）→ 401
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    if (!token) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
  }

  // 为 app layout 的向导检测传递路径信息
  const res = NextResponse.next()
  res.headers.set('x-next-url', pathname)
  return res
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|login).*)',
  ],
}
