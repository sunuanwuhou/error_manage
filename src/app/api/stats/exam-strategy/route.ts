// src/app/api/stats/exam-strategy/route.ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: userId },
    select: { examDate: true },
  })
  const daysToExam = user.examDate
    ? Math.ceil((new Date(user.examDate).getTime() - Date.now()) / 86400000)
    : null

  const errors = await prisma.userError.findMany({
    where:   { userId },
    include: { question: { select: { type: true } } },
  })

  const bySection: Record<string, { stockified: number; total: number }> = {}
  errors.forEach(e => {
    const t = e.question.type
    if (!bySection[t]) bySection[t] = { stockified: 0, total: 0 }
    bySection[t].total++
    if (e.isStockified) bySection[t].stockified++
  })

  const strategy = Object.entries(bySection)
    .map(([section, d]) => {
      const rate = d.total > 0 ? d.stockified / d.total : 0
      let suggestion: string
      let color: string
      if (rate >= 0.7) {
        suggestion = '先做 · 稳拿分'
        color = 'bg-green-100 text-green-700'
      } else if (rate >= 0.4) {
        suggestion = '正常顺序'
        color = 'bg-blue-100 text-blue-700'
      } else if (daysToExam !== null && daysToExam <= 30) {
        suggestion = '最后做 · 量力而行'
        color = 'bg-gray-100 text-gray-500'
      } else {
        suggestion = '继续攻坚'
        color = 'bg-amber-100 text-amber-700'
      }
      return { section, stockifiedRate: rate, stockified: d.stockified, total: d.total, suggestion, color }
    })
    .sort((a, b) => b.stockifiedRate - a.stockifiedRate)

  return NextResponse.json(strategy)
}
