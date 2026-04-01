import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { inferPaperQuestionOrder } from '@/lib/papers'
import { buildFingerprint, qualityCheck, shouldReplaceExisting, type DuplicateMode } from '@/lib/import/duplicate-policy'
import { updateImportJobResult } from '@/lib/import/import-job'
import { evaluateImportQuality, inferQuestionType } from '@/lib/import/quality-gate'

const schema = z.object({
  importJobId: z.string().optional(),
  payload: z.string().optional(),
  srcYear: z.string().optional(),
  srcProvince: z.string().optional(),
  srcSession: z.string().optional(),
  srcOrigin: z.string().optional(),
  examType: z.string().optional(),
  duplicateMode: z.enum(['skip', 'replace_low_quality', 'force_replace']).optional(),
  addToErrors: z.array(z.number()).optional(),
  selected: z.array(z.number()).optional(),
})

type ImportedQuestion = {
  index?: number
  no: string
  content: string
  questionImage?: string
  options: string[]
  answer: string
  type: string
  analysis?: string
  examType?: string
  srcName?: string
  srcOrigin?: string
  rawText?: string
}

function decodePayload(payload: string): ImportedQuestion[] {
  const binary = Buffer.from(payload, 'base64').toString('utf8')
  return JSON.parse(binary)
}

function safeParseOptions(raw?: string | null) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function findExistingQuestion(args: {
  examType: string
  srcYear: string | null
  srcProvince: string | null
  srcSession: string | null
  srcQuestionNo: string | null
  srcQuestionOrder: number | null
  fingerprint: string
}) {
  const exact = await prisma.question.findFirst({
    where: {
      examType: args.examType,
      srcYear: args.srcYear,
      srcProvince: args.srcProvince,
      srcExamSession: args.srcSession,
      ...(args.srcQuestionNo ? { srcQuestionNo: args.srcQuestionNo } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
  if (exact) return exact

  const orderMatched = await prisma.question.findFirst({
    where: {
      examType: args.examType,
      srcYear: args.srcYear,
      srcProvince: args.srcProvince,
      srcExamSession: args.srcSession,
      ...(args.srcQuestionOrder != null ? { srcQuestionOrder: args.srcQuestionOrder } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
  if (orderMatched) return orderMatched

  const candidates = await prisma.question.findMany({
    where: {
      examType: args.examType,
      srcYear: args.srcYear,
      srcProvince: args.srcProvince,
    },
    take: 100,
    orderBy: { createdAt: 'desc' },
  })

  return candidates.find(item => buildFingerprint({
    content: item.content,
    options: safeParseOptions(item.options),
    answer: item.answer,
  }) === args.fingerprint) || null
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const duplicateMode: DuplicateMode = data.duplicateMode || 'replace_low_quality'
  const selectedSet = new Set(data.selected || [])
  const addToErrors = new Set(data.addToErrors || [])

  let questions: ImportedQuestion[] = []
  try {
    if (data.importJobId) {
      const job = await prisma.importJob.findFirst({ where: { id: data.importJobId, userId } })
      if (!job) return NextResponse.json({ error: '导入任务不存在' }, { status: 404 })
      questions = job.parsedQuestions ? JSON.parse(job.parsedQuestions) : []
    } else if (data.payload) {
      questions = decodePayload(data.payload)
    } else {
      return NextResponse.json({ error: '缺少 importJobId 或 payload' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: '导入载荷解码失败' }, { status: 400 })
  }

  const targetQuestions = selectedSet.size
    ? questions.filter(item => item.index != null && selectedSet.has(item.index))
    : questions

  const blockedQuestions: Array<{ no: string; issues: string[] }> = []
  targetQuestions.forEach((q, i) => {
    const normalized = { ...q, type: inferQuestionType(q as any) }
    const gate = evaluateImportQuality(normalized as any)
    if (gate.blockers.length) {
      blockedQuestions.push({
        no: q.no || String(i + 1),
        issues: gate.blockers.map(item => item.label),
      })
    }
  })

  if (blockedQuestions.length) {
    return NextResponse.json({
      error: '存在阻断题，已禁止发布到练习',
      blockedQuestions,
      blockedCount: blockedQuestions.length,
    }, { status: 400 })
  }

  let imported = 0
  let skipped = 0
  let overwritten = 0
  let addedToErrors = 0
  let lowQuality = 0
  let failed = 0
  let stableIdUpdates = 0
  const typeBreakdown: Record<string, number> = {}
  const qualityReport: Array<{ no: string; score: number; issues: string[] }> = []
  const failureReport: Array<{ no: string; message: string }> = []

  try {
    for (const [i, q] of targetQuestions.entries()) {
      try {
        const normalized = { ...q, type: inferQuestionType(q as any) }
        const quality = qualityCheck({
          content: normalized.content,
          options: normalized.options,
          answer: normalized.answer,
          analysis: normalized.analysis,
        })
        qualityReport.push({ no: normalized.no || String(i + 1), score: quality.score, issues: quality.issues })
        if (quality.score < 60) lowQuality += 1

        const content = String(normalized.content || '').trim()
        const sourceQuestionOrder = inferPaperQuestionOrder(normalized.no || null)
        const fingerprint = buildFingerprint({ content, options: normalized.options, answer: normalized.answer })

        const finalExamType = data.examType || normalized.examType || 'common'
        const finalSrcYear = data.srcYear || null
        const finalSrcProvince = data.srcProvince || null
        const finalSrcSession = data.srcSession || null
        const finalSrcOrigin = data.srcOrigin || normalized.srcOrigin || null
        const finalSrcQuestionNo = normalized.no || null

        const existing = await findExistingQuestion({
          examType: finalExamType,
          srcYear: finalSrcYear,
          srcProvince: finalSrcProvince,
          srcSession: finalSrcSession,
          srcQuestionNo: finalSrcQuestionNo,
          srcQuestionOrder: sourceQuestionOrder,
          fingerprint,
        })

        let questionId: string | null = null

        if (existing) {
          if (shouldReplaceExisting({
            mode: duplicateMode,
            existing,
            incoming: { content, options: normalized.options, analysis: normalized.analysis, answer: normalized.answer },
          })) {
            const updated = await prisma.question.update({
              where: { id: existing.id },
              data: {
                content,
                questionImage: normalized.questionImage || existing.questionImage,
                options: JSON.stringify((normalized.options || []).filter(Boolean)),
                answer: normalized.answer || existing.answer,
                analysis: normalized.analysis || existing.analysis,
                type: normalized.type || existing.type,
                examType: finalExamType,
                srcYear: finalSrcYear,
                srcProvince: finalSrcProvince,
                srcExamSession: finalSrcSession,
                srcOrigin: finalSrcOrigin,
                srcQuestionNo: finalSrcQuestionNo,
                srcQuestionOrder: sourceQuestionOrder ?? existing.srcQuestionOrder,
                isFromOfficialBank: true,
                isPublic: true,
              },
            })
            questionId = updated.id
            overwritten += 1
            stableIdUpdates += 1
          } else {
            questionId = existing.id
            skipped += 1
          }
        } else {
          const created = await prisma.question.create({
            data: {
              addedBy: userId,
              content,
              questionImage: normalized.questionImage || null,
              options: JSON.stringify((normalized.options || []).filter(Boolean)),
              answer: normalized.answer || '',
              analysis: normalized.analysis || null,
              type: normalized.type || '单项选择题',
              examType: finalExamType,
              srcYear: finalSrcYear,
              srcProvince: finalSrcProvince,
              srcExamSession: finalSrcSession,
              srcOrigin: finalSrcOrigin,
              srcQuestionNo: finalSrcQuestionNo,
              srcQuestionOrder: sourceQuestionOrder,
              isFromOfficialBank: true,
              isPublic: true,
            },
          })
          questionId = created.id
          imported += 1
        }

        typeBreakdown[normalized.type || '未分类'] = (typeBreakdown[normalized.type || '未分类'] || 0) + 1

        if (questionId && normalized.index != null && addToErrors.has(normalized.index)) {
          const existedError = await prisma.userError.findUnique({
            where: { userId_questionId: { userId, questionId } },
          })
          if (!existedError) {
            await prisma.userError.create({
              data: {
                userId,
                questionId,
                myAnswer: '',
                errorReason: '批量导入后加入错题本',
                masteryPercent: 0,
                reviewInterval: 1,
                nextReviewAt: new Date(),
              },
            })
            addedToErrors += 1
          }
        }
      } catch (error: any) {
        failed += 1
        failureReport.push({ no: q.no || String(i + 1), message: error?.message || '未知异常' })
      }
    }

    if (data.importJobId) {
      await updateImportJobResult({
        importJobId: data.importJobId,
        importedCount: imported + overwritten,
        status: failed > 0 ? 'done_with_errors' : 'done',
        failReason: failureReport.length ? JSON.stringify(failureReport) : null,
      })
    }

    const safeYear = data.srcYear || ''
    const safeProvince = data.srcProvince || ''
    const safeExamType = data.examType || 'common'
    const paperKey = [safeYear, safeProvince, safeExamType].filter(Boolean).join('__')

    return NextResponse.json({
      imported,
      skipped,
      overwritten,
      addedToErrors,
      lowQuality,
      failed,
      total: targetQuestions.length,
      stableIdUpdates,
      duplicateStrategyNote: '覆盖 = 更新原题内容，保留 question.id 不变',
      typeBreakdown,
      qualityReport,
      failureReport,
      paperKey,
      practiceHref: paperKey ? `/practice?paperKey=${encodeURIComponent(paperKey)}` : '/practice',
      practiceHrefLimit20: paperKey ? `/practice?paperKey=${encodeURIComponent(paperKey)}&limit=20` : '/practice?limit=20',
    })
  } catch (error: any) {
    if (data.importJobId) {
      await updateImportJobResult({
        importJobId: data.importJobId,
        importedCount: imported + overwritten,
        status: 'failed',
        failReason: error?.message || 'confirm failed',
      }).catch(() => {})
    }
    return NextResponse.json({ error: error?.message || '导入确认失败' }, { status: 500 })
  }
}
