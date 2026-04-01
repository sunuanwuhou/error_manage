import { NextRequest, NextResponse } from 'next/server'

const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now()
  const windowMs = 15 * 60 * 1000
  const max = 5

  const record = loginAttempts.get(ip)
  if (!record || record.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (record.count >= max) return false
  record.count += 1
  return true
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const skipLoginRateLimit = process.env.PLAYWRIGHT === 'true' || process.env.E2E_TEST_MODE === '1'

  if (!skipLoginRateLimit && pathname === '/api/auth/callback/credentials' && req.method === 'POST') {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? '127.0.0.1'

    if (!checkLoginRateLimit(ip)) {
      const loginUrl = new URL('/login?error=RateLimit', req.nextUrl.origin).toString()
      return NextResponse.json(
        {
          error: 'RateLimit',
          message: '登录尝试过于频繁，请 15 分钟后再试',
          url: loginUrl,
        },
        { status: 429 },
      )
    }
  }

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
