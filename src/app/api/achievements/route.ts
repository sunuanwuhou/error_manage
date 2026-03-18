// src/app/api/achievements/route.ts — 成就徽章（A6 §功能70）

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { calcStreak } from '@/lib/streak'
import { prisma } from '@/lib/prisma'

const BADGES = [
  { id: 'streak_7',   label: '坚持一周',   icon: '🔥', threshold: 7,  type: 'streak' },
  { id: 'streak_30',  label: '月度勇士',   icon: '💎', threshold: 30, type: 'streak' },
  { id: 'stock_1',    label: '第一稳固',   icon: '⭐', threshold: 1,  type: 'stockified' },
  { id: 'stock_10',   label: '十题稳固',   icon: '🏅', threshold: 10, type: 'stockified' },
  { id: 'stock_30',   label: '三十稳固',   icon: '🏆', threshold: 30, type: 'stockified' },
  { id: 'review_100', label: '百题复习',   icon: '📚', threshold: 100, type: 'reviews' },
]

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const [streakResult, stockifiedCount, reviewCount] = await Promise.all([
    calcStreak(userId),
    prisma.userError.count({ where: { userId, isStockified: true } }),
    prisma.reviewRecord.count({ where: { userId } }),
  ])

  const earned = BADGES.map(badge => {
    let value = 0
    if (badge.type === 'streak')     value = streakResult.best
    if (badge.type === 'stockified') value = stockifiedCount
    if (badge.type === 'reviews')    value = reviewCount
    return { ...badge, earned: value >= badge.threshold, progress: Math.min(value, badge.threshold), value }
  })

  return NextResponse.json(earned)
}
