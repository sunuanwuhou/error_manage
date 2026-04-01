import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { autoFixBatch } from '@/lib/import/auto-fix'
import { evaluateImportQuality } from '@/lib/import/quality-gate'

function parsePaperKey(paperKey: string) {
  const [srcYear, srcProvince, examType] = String(paperKey || '').split('__')
  return { srcYear, srcProvince, examType }
}

function safeParseOptions(raw?: string | null) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(v => String(v || '')) : []
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const paperKey = searchParams.get('paperKey') || ''
  const limit = Math.min(Number(searchParams.get('limit') || '50') || 50, 200)

  if (!paperKey) return NextResponse.json({ error: '缺少 paperKey' }, { status: 400 })

  const { srcYear, srcProvince, examType } = parsePaperKey(paperKey)
  const where: any = { isPublic: true }
  if (srcYear && srcYear !== 'unknown') where.srcYear = srcYear
  if (srcProvince && srcProvince !== 'common') where.srcProvince = srcProvince
  if (examType && examType !== 'common') where.examType = examType

  const questions = await prisma.question.findMany({
    where,
    orderBy: [{ srcQuestionOrder: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  })

  const candidates = questions.map((q, idx) => {
    const current = {
      index: idx,
      no: String(q.srcQuestionNo || q.srcQuestionOrder || idx + 1),
      content: String(q.content || ''),
      questionImage: String(q.questionImage || ''),
      options: safeParseOptions(q.options),
      answer: String(q.answer || ''),
      type: String(q.type || ''),
      analysis: String(q.analysis || ''),
      rawText: '',
    }
    const quality = evaluateImportQuality(current as any)
    if (!quality.issues.length) return null
    const fixed = autoFixBatch([current as any]).items[0]
    return {
      id: q.id,
      no: current.no,
      type: current.type,
      issues: quality.issues.map(item => ({ code: item.code, label: item.label, severity: item.severity })),
      current,
      suggested: fixed,
    }
  }).filter(Boolean)

  return NextResponse.json({
    paperKey,
    totalScanned: questions.length,
    candidateCount: candidates.length,
    items: candidates,
  })
}
