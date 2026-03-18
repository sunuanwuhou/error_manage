// src/app/api/daily-tasks/route.ts
// 返回今日推题队列（错题复盘 + 真题补位）

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildDailyQueue } from '@/lib/daily-tasks'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const userId = (session.user as any).id

  const queue = await buildDailyQueue(userId)

  return NextResponse.json(queue)
}
