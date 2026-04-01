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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { paperKey?: string; limit?: number; onlyBlocked?: boolean }
  const paperKey = String(body.paperKey || '')
  const limit = Math.min(Number(body.limit || 100) || 100, 300)
  const onlyBlocked = body.onlyBlocked !== false

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

  let scanned = 0
  let updated = 0
  let skipped = 0
  const samples: Array<{ id: string; no: string; changedFields: string[] }> = []

  for (const q of questions) {
    scanned += 1
    const current = {
      index: 0,
      no: String(q.srcQuestionNo || q.srcQuestionOrder || ''),
      content: String(q.content || ''),
      questionImage: String(q.questionImage || ''),
      options: safeParseOptions(q.options),
      answer: String(q.answer || ''),
      type: String(q.type || ''),
      analysis: String(q.analysis || ''),
      rawText: '',
    }
    const quality = evaluateImportQuality(current as any)
    if (onlyBlocked && !quality.blockers.length) {
      skipped += 1
      continue
    }
    if (!quality.issues.length) {
      skipped += 1
      continue
    }

    const suggested = autoFixBatch([current as any]).items[0]
    const changedFields: string[] = []
    if (String(suggested.content || '').trim() !== current.content.trim()) changedFields.push('content')
    if (JSON.stringify((suggested.options || []).filter(Boolean)) !== JSON.stringify((current.options || []).filter(Boolean))) changedFields.push('options')
    if (String(suggested.answer || '').trim() !== current.answer.trim()) changedFields.push('answer')
    if (String(suggested.type || '').trim() !== current.type.trim()) changedFields.push('type')
    if (String(suggested.analysis || '').trim() !== current.analysis.trim()) changedFields.push('analysis')
    if (String(suggested.questionImage || '').trim() !== current.questionImage.trim()) changedFields.push('questionImage')

    if (!changedFields.length) {
      skipped += 1
      continue
    }

    await prisma.question.update({
      where: { id: q.id },
      data: {
        content: suggested.content || q.content,
        questionImage: suggested.questionImage || q.questionImage,
        options: JSON.stringify((suggested.options || []).filter(Boolean)),
        answer: suggested.answer || q.answer,
        type: suggested.type || q.type,
        analysis: suggested.analysis || q.analysis,
      },
    })
    updated += 1
    if (samples.length < 20) {
      samples.push({ id: q.id, no: current.no || '-', changedFields })
    }
  }

  return NextResponse.json({ ok: true, paperKey, scanned, updated, skipped, samples })
}
