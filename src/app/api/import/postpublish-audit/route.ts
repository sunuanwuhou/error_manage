import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { evaluateImportQuality } from '@/lib/import/quality-gate'

function safeParseOptions(raw?: string | null) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const paperKey = searchParams.get('paperKey') || ''
  if (!paperKey) return NextResponse.json({ error: '缺少 paperKey' }, { status: 400 })

  const [srcYear, srcProvince, examType] = paperKey.split('__')
  const where: any = { isPublic: true }
  if (srcYear && srcYear !== 'unknown') where.srcYear = srcYear
  if (srcProvince && srcProvince !== 'common') where.srcProvince = srcProvince
  if (examType && examType !== 'common') where.examType = examType

  const items = await prisma.question.findMany({
    where,
    orderBy: [{ srcQuestionOrder: 'asc' }, { createdAt: 'asc' }],
    take: 500,
  })

  const typeBreakdown: Record<string, number> = {}
  const orderMap = new Map<string, number>()
  const noMap = new Map<string, number>()
  const blockers: Array<{ id: string; no: string; type: string; issues: string[] }> = []
  const warnings: Array<{ id: string; no: string; type: string; issues: string[] }> = []

  for (const item of items) {
    const options = safeParseOptions(item.options)
    const gate = evaluateImportQuality({
      index: 0,
      no: item.srcQuestionNo || String(item.srcQuestionOrder || ''),
      content: item.content,
      options,
      answer: item.answer,
      type: item.type,
      analysis: item.analysis || '',
      questionImage: item.questionImage || '',
    })
    typeBreakdown[item.type || '未分类'] = (typeBreakdown[item.type || '未分类'] || 0) + 1
    const orderKey = String(item.srcQuestionOrder || '')
    const noKey = String(item.srcQuestionNo || '')
    if (orderKey) orderMap.set(orderKey, (orderMap.get(orderKey) || 0) + 1)
    if (noKey) noMap.set(noKey, (noMap.get(noKey) || 0) + 1)
    if (gate.blockers.length) blockers.push({ id: item.id, no: item.srcQuestionNo || '', type: item.type || '', issues: gate.blockers.map(v => v.label) })
    else if (gate.warnings.length) warnings.push({ id: item.id, no: item.srcQuestionNo || '', type: item.type || '', issues: gate.warnings.map(v => v.label) })
  }

  const duplicateOrders = Array.from(orderMap.entries()).filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }))
  const duplicateNos = Array.from(noMap.entries()).filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }))

  return NextResponse.json({
    paperKey,
    total: items.length,
    typeBreakdown,
    duplicateOrders,
    duplicateNos,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    blockers: blockers.slice(0, 20),
    warnings: warnings.slice(0, 20),
    sample: items.slice(0, 10).map(item => ({
      id: item.id,
      no: item.srcQuestionNo,
      order: item.srcQuestionOrder,
      type: item.type,
      content: item.content,
      answer: item.answer,
      options: safeParseOptions(item.options),
    })),
  })
}
