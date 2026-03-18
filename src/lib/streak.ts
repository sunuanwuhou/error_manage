// src/lib/streak.ts
// 连续打卡计算（§0.9 §功能70）
// 规则：每日完成 ≥1 道题 streak +1；断签不清零历史最高

import { prisma } from './prisma'
import { startOfDay, subDays, differenceInCalendarDays } from 'date-fns'

export interface StreakResult {
  current: number   // 当前连续天数
  best:    number   // 历史最高连续天数
  today:   boolean  // 今天是否已打卡
}

export async function calcStreak(userId: string): Promise<StreakResult> {
  // 拉取最近 90 天内每天是否有做题记录
  const since = subDays(new Date(), 90)

  const records = await prisma.reviewRecord.findMany({
    where:   { userId, createdAt: { gte: since } },
    select:  { createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  if (records.length === 0) return { current: 0, best: 0, today: false }

  // 聚合：每天只算一次（去重到日期）
  const days = new Set(
    records.map(r => startOfDay(r.createdAt).toISOString())
  )
  const sortedDays = Array.from(days)
    .map(d => new Date(d))
    .sort((a, b) => b.getTime() - a.getTime())  // 降序（最新在前）

  const todayStr  = startOfDay(new Date()).toISOString()
  const todayDone = days.has(todayStr)

  // 从今天或昨天开始往回数连续天数
  const startFrom = todayDone ? new Date() : subDays(new Date(), 1)
  let current = 0
  let best    = 0
  let streak  = 0
  let prev    = startOfDay(startFrom)

  for (const day of sortedDays) {
    const diff = differenceInCalendarDays(prev, day)
    if (diff === 0) {
      // 同一天，继续
      if (streak === 0) streak = 1
    } else if (diff === 1) {
      // 连续
      streak++
      prev = day
    } else {
      // 断了，记录一段后重置
      best = Math.max(best, streak)
      streak = 1
      prev   = day
    }
  }

  best    = Math.max(best, streak)
  current = todayDone ? streak : 0

  // 若今天还没打卡但昨天打了，current 用昨天的连续数（提示用户继续）
  if (!todayDone && sortedDays[0]) {
    const diff = differenceInCalendarDays(new Date(), sortedDays[0])
    if (diff === 1) current = streak  // 昨天打了，连续未断
    else            current = 0       // 已断签
  }

  return { current, best, today: todayDone }
}
