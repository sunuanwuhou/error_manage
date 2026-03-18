// src/app/api/error-patterns/route.ts
// 错误陷阱聚合（§0.7③）：分析最近错题的错因分布

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  // 最近30条答错记录
  const recentErrors = await prisma.reviewRecord.findMany({
    where:   { userId, isCorrect: false },
    orderBy: { createdAt: 'desc' },
    take:    30,
    include: {
      userError: {
        include: { question: { select: { type: true } } },
      },
    },
  })

  if (recentErrors.length < 5) {
    return NextResponse.json({ insufficient: true, count: recentErrors.length, needed: 30 })
  }

  // 按 错因Tag + 题型 聚合
  const patternMap: Record<string, { count: number; type: string; tag: string }> = {}
  recentErrors.forEach(r => {
    const tag  = r.userError.aiReasonTag || r.userError.reasonTag || '未分类'
    const type = r.userError.question.type
    const key  = `${type}::${tag}`
    if (!patternMap[key]) patternMap[key] = { count: 0, type, tag }
    patternMap[key].count++
  })

  const patterns = Object.values(patternMap)
    .filter(p => p.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // 高频错因 → 生成专项训练建议
  const suggestions = patterns.map(p => ({
    type:       p.type,
    tag:        p.tag,
    count:      p.count,
    percentage: Math.round((p.count / recentErrors.length) * 100),
    advice:     getAdvice(p.type, p.tag),
  }))

  return NextResponse.json({
    insufficient: false,
    total:        recentErrors.length,
    patterns:     suggestions,
    generatedAt:  new Date().toISOString(),
  })
}

function getAdvice(type: string, tag: string): string {
  const map: Record<string, string> = {
    '概念混淆':  '建议专项练习该题型的概念辨析题，做题前先默写核心定义',
    '审题粗心':  '建议放慢审题速度，圈出关键词再选答案',
    '计算失误':  '建议在草稿纸上写出每步计算，不要跳步',
    '方法不熟':  '建议回看修正卡，反复练习直到方法内化',
    '时间不足':  '建议进入计时训练模式，限时60%严格训练',
    '未分类':    '建议录入错误原因，帮助 AI 更精准诊断',
  }
  return map[tag] ?? `建议针对"${type} - ${tag}"进行专项练习`
}
