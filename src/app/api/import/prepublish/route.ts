import { NextRequest, NextResponse } from 'next/server'
import { evaluateImportQuality, inferQuestionType } from '@/lib/import/quality-gate'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const items = Array.isArray(body?.items) ? body.items : []

  const blockedQuestions: Array<{ index: number; no: string; issues: string[]; type: string }> = []
  const warningQuestions: Array<{ index: number; no: string; issues: string[]; type: string }> = []
  const typeBreakdown: Record<string, number> = {}

  items.forEach((item: any, idx: number) => {
    const normalized = { ...item, type: inferQuestionType(item as any) }
    const gate = evaluateImportQuality(normalized as any)
    const no = String(item?.no || idx + 1)
    typeBreakdown[normalized.type] = (typeBreakdown[normalized.type] || 0) + 1
    if (gate.blockers.length) {
      blockedQuestions.push({ index: Number(item?.index ?? idx), no, type: normalized.type, issues: gate.blockers.map(v => v.label) })
    } else if (gate.warnings.length) {
      warningQuestions.push({ index: Number(item?.index ?? idx), no, type: normalized.type, issues: gate.warnings.map(v => v.label) })
    }
  })

  return NextResponse.json({
    total: items.length,
    publishableCount: items.length - blockedQuestions.length,
    blockedCount: blockedQuestions.length,
    warningCount: warningQuestions.length,
    recommendedIndexes: items.filter((item: any, idx: number) => !blockedQuestions.some(v => v.index === Number(item?.index ?? idx))).map((item: any, idx: number) => Number(item?.index ?? idx)),
    blockedQuestions: blockedQuestions.slice(0, 50),
    warningQuestions: warningQuestions.slice(0, 50),
    typeBreakdown,
  })
}
