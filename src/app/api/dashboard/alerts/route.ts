// src/app/api/dashboard/alerts/route.ts
// 首页告警：reboundAlert、激活期切换、Day7里程碑、任务溢出

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { differenceInDays } from 'date-fns'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: userId },
    select: { examDate: true, createdAt: true },
  })

  const alerts: Array<{
    type: string
    title: string
    body: string
    action?: string
    actionLabel?: string
    severity: 'info' | 'warn' | 'success'
  }> = []

  const now        = new Date()
  const daysToExam = user.examDate ? differenceInDays(new Date(user.examDate), now) : null
  const daysSince  = differenceInDays(now, user.createdAt)

  // 1. reboundAlert：掌握度反弹的题
  const reboundErrors = await prisma.userError.findMany({
    where:   { userId, reboundAlert: true },
    include: { question: { select: { type: true } } },
    take:    3,
  })
  if (reboundErrors.length > 0) {
    alerts.push({
      type:       'rebound',
      severity:   'warn',
      title:      `⚠️ ${reboundErrors.length} 道题掌握度回落`,
      body:       reboundErrors.map(e => `${e.question.type} · ${e.masteryPercent}%`).join('、'),
      action:     '/practice',
      actionLabel: '现在补练',
    })
  }

  // 2. 激活期切换（daysToExam 刚进入 14 天）
  if (daysToExam !== null && daysToExam <= 14 && daysToExam >= 12) {
    alerts.push({
      type:     'activation',
      severity: 'info',
      title:    `🔥 距考试 ${daysToExam} 天，已进入冲刺模式`,
      body:     '今日起改为激活已有记忆，不引入新知识，每日目标降为 50 道',
    })
  }

  // 3. Day7 里程碑防流失卡片
  if (daysSince === 7 || daysSince === 8) {
    const weekReviews = await prisma.reviewRecord.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    })
    const progressed = await prisma.userError.count({
      where: { userId, masteryPercent: { gt: 30 } },
    })
    // 找最接近升级的题
    const nearest = await prisma.userError.findFirst({
      where:   { userId, isStockified: false, masteryPercent: { gte: 40 } },
      orderBy: { masteryPercent: 'desc' },
      include: { question: { select: { type: true } } },
    })
    alerts.push({
      type:     'day7',
      severity: 'success',
      title:    '🎉 坚持一周！',
      body:     `本周完成 ${weekReviews} 道复习，${progressed} 道题掌握度提升。${nearest ? `最接近升级：${nearest.question.type} · ${nearest.masteryPercent}%` : ''}`,
    })
  }

  // 4. 考前 48 小时超级激活
  if (daysToExam !== null && daysToExam <= 2 && daysToExam >= 0) {
    alerts.push({
      type:       'super_activate',
      severity:   'warn',
      title:      `🚀 距考试仅剩 ${daysToExam === 0 ? '不到1天' : `${daysToExam}天`}`,
      body:       '今天只做两件事：快速过口诀 + 激活 60-80% 的考点，不引入新题',
      action:     '/practice',
      actionLabel: '开始超级激活',
    })
  }

  // 5. 慢正确自动触发计时训练建议（§0.7②）
  const slowCount = await prisma.userError.count({
    where: { userId, isLastSlowCorrect: true, isStockified: false },
  })
  if (slowCount >= 3) {
    alerts.push({
      type:       'slow_correct',
      severity:   'warn',
      title:      `⏱️ ${slowCount} 道题反复"慢正确"`,
      body:       '答对但超时 = 实考等于丢分。建议进入计时训练模式，限时60%专项提速。',
      action:     '/practice/special?mode=timed',
      actionLabel: '进入计时训练',
    })
  }

  // 6. 考前策略动态收敛通知
  if (daysToExam !== null) {
    if (daysToExam === 30) {
      const lowMastery = await prisma.userError.count({
        where: { userId, masteryPercent: { lt: 30 }, isStockified: false },
      })
      if (lowMastery > 0) {
        alerts.push({
          type:     'strategy_converge_30',
          severity: 'info',
          title:    '📅 距考试30天，策略调整',
          body:     `有 ${lowMastery} 道 mastery<30% 的题建议战略放弃，集中精力攻已有积累的考点。`,
        })
      }
    }
    if (daysToExam === 14) {
      alerts.push({
        type:     'strategy_converge_14',
        severity: 'warn',
        title:    '🔥 进入激活期，停止建设新考点',
        body:     '今日起只激活已有记忆（mastery 60-80%），绝不引入新知识。任务已自动降为50道。',
      })
    }
    if (daysToExam === 7) {
      alerts.push({
        type:     'strategy_converge_7',
        severity: 'warn',
        title:    '⚡ 最后7天：只做激活，不做新题',
        body:     '新题此时引入只会增加焦虑，不提分。专注口诀激活和增量候选队列。',
        action:   '/anchors',
        actionLabel: '过口诀',
      })
    }
  }

  return NextResponse.json(alerts)
}
