// src/app/api/import/confirm/route.ts
// 导入确认：写入题库 + ExamTopicStats自动填充 + 真题练习队列 + 质检

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { ParsedQuestion } from '@/lib/parsers/pdf-parser'

const schema = z.object({
  payload:     z.string(),
  srcYear:     z.string().optional(),
  srcProvince: z.string().optional(),
  srcSession:  z.string().optional(),
  addToErrors: z.array(z.number()).optional(),
})

// ── 质检评分：判断一道题的解析质量 ─────────────────────────────────
function qualityCheck(q: ParsedQuestion): {
  score:    number   // 0-100
  issues:   string[]
} {
  const issues: string[] = []
  let score = 100

  // 题目太短（可能截断）
  if (q.content.length < 20) { issues.push('题目过短，可能截断'); score -= 30 }

  // 选项数量不对
  if (q.options.length < 4)  { issues.push(`选项只有${q.options.length}个`); score -= 20 }

  // 没有答案
  if (!q.answer)             { issues.push('缺少答案'); score -= 15 }

  // 答案不合法
  if (q.answer && !/^[ABCD]$/.test(q.answer)) { issues.push(`答案格式异常: ${q.answer}`); score -= 15 }

  // 选项字母不连续（如只有A、C，跳过了B）
  if (q.options.length > 0) {
    const letters = q.options.map(o => o.charAt(0)).sort()
    const expected = ['A','B','C','D'].slice(0, letters.length)
    if (JSON.stringify(letters) !== JSON.stringify(expected)) {
      issues.push('选项字母不连续'); score -= 10
    }
  }

  // 题目内容包含选项文字（说明选项没有正确拆分）
  if (/[AB]\.[^\n]{2,}[CD]\./.test(q.content)) {
    issues.push('选项可能混入题目正文'); score -= 20
  }

  return { score: Math.max(0, score), issues }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })
  const d = parsed.data

  let questions: Array<ParsedQuestion & { examType: string; srcName: string }>
  try {
    questions = JSON.parse(Buffer.from(d.payload, 'base64').toString('utf-8'))
  } catch {
    return NextResponse.json({ error: 'payload 解析失败，请重新上传' }, { status: 400 })
  }

  const addSet          = new Set(d.addToErrors ?? [])
  const importedIds:    string[] = []
  const qualityReport:  Array<{ no: string; score: number; issues: string[] }> = []

  let imported      = 0
  let skipped       = 0
  let addedToErrors = 0
  let lowQuality    = 0

  // 按题型统计（用于 ExamTopicStats）
  const typeCount: Record<string, number> = {}

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    if (!q.content || q.content.length < 5) continue

    // 质检
    const { score, issues } = qualityCheck(q)
    if (issues.length > 0) {
      qualityReport.push({ no: q.no, score, issues })
      if (score < 50) { lowQuality++; continue }  // 质量太差直接跳过
    }

    // 统计题型
    typeCount[q.type] = (typeCount[q.type] ?? 0) + 1

    try {
      const existing = await prisma.question.findFirst({
        where:  { content: q.content },
        select: { id: true },
      })

      let questionId: string

      if (existing) {
        questionId = existing.id
        skipped++
      } else {
        const created = await prisma.question.create({
          data: {
            addedBy:            userId,
            content:            q.content,
            options:            JSON.stringify(q.options),
            answer:             q.answer || '',
            analysis:           q.analysis || null,
            type:               q.type,
            examType:           q.examType ?? 'common',
            srcYear:            d.srcYear ?? null,
            srcProvince:        d.srcProvince ?? null,
            srcExamSession:     d.srcSession ?? q.srcName ?? null,
            isFromOfficialBank: true,
            isPublic:           true,
          },
        })
        questionId = created.id
        importedIds.push(questionId)
        imported++
      }

      if (addSet.has(i) && questionId) {
        const alreadyIn = await prisma.userError.findUnique({
          where: { userId_questionId: { userId, questionId } },
        })
        if (!alreadyIn) {
          await prisma.userError.create({
            data: {
              userId, questionId,
              myAnswer: '', errorReason: '批量导入',
              masteryPercent: 0, reviewInterval: 1,
              nextReviewAt: new Date(),
            },
          })
          addedToErrors++
        }
      }
    } catch (err: any) {
      console.error(`[导入] 第${i+1}题失败：${err.message}`)
    }
  }

  // ── Fix 1: ExamTopicStats 自动填充 ─────────────────────────────
  if (imported > 0) {
    await rebuildExamTopicStats(d.srcSession ?? 'unknown', questions[0]?.examType ?? 'common', typeCount, d.srcYear)
  }

  // ── Fix 2: 写入 PracticePool（真题练习队列）────────────────────
  if (importedIds.length > 0) {
    await addToPracticePool(userId, importedIds)
  }

  // ── 触发 AnalysisQueue ─────────────────────────────────────────
  if (importedIds.length > 0) {
    triggerAnalysisQueue(importedIds, questions[0]?.examType ?? 'common').catch(() => {})
  }

  // ── ActivityLog ────────────────────────────────────────────────
  import('@/lib/activity/logger').then(({ logImportCompleted }) => {
    logImportCompleted(userId, {
      filename:    d.srcSession ?? 'unknown',
      examType:    questions[0]?.examType ?? 'common',
      totalQuestions: questions.length,
      newQuestions: imported,
      skipped,
      skillTagsFound:       Object.keys(typeCount),
      analysisTasksCreated: 0,
    }).catch(() => {})
  })

  return NextResponse.json({
    imported,
    skipped,
    addedToErrors,
    lowQuality,
    total: questions.length,
    qualityReport,   // 质检报告（前端展示）
    typeBreakdown: typeCount,
  })
}

// ── Fix 1: ExamTopicStats 自动填充 ──────────────────────────────
async function rebuildExamTopicStats(
  srcSession: string,
  examType:   string,
  typeCount:  Record<string, number>,
  srcYear?:   string
) {
  // 统计该 examType 下所有题目的题型分布
  const allByType = await prisma.question.groupBy({
    by:    ['type'],
    where: { examType, isFromOfficialBank: true },
    _count: { id: true },
  })

  const total = allByType.reduce((sum, r) => sum + r._count.id, 0)
  if (total === 0) return

  for (const row of allByType) {
    const frequency = row._count.id / total
    // upsert：有则更新频率，无则创建
    await prisma.examTopicStats.upsert({
      where:  { examType_skillTag: { examType, skillTag: row.type } },
      update: { frequency, questionCount: row._count.id, updatedAt: new Date() },
      create: {
        examType,
        skillTag:      row.type,
        sectionType:   row.type,
        frequency,
        questionCount: row._count.id,
        difficulty:    0.5,
      },
    })
  }
  console.log(`[ExamTopicStats] 已更新 ${allByType.length} 个考点频率`)
}

// ── Fix 2: 真题练习池 ────────────────────────────────────────────
// 把新导入的题写入 PracticeRecord 的"待练"状态
// daily-tasks 读这个池子来补位真题练习
async function addToPracticePool(userId: string, questionIds: string[]) {
  // 过滤掉已经练过的题
  const existing = await prisma.practiceRecord.findMany({
    where:  { userId, questionId: { in: questionIds } },
    select: { questionId: true },
  })
  const doneIds = new Set(existing.map(r => r.questionId))
  const newIds  = questionIds.filter(id => !doneIds.has(id))

  if (newIds.length === 0) return

  // 批量写入 pending 状态的练习记录
  await prisma.practiceRecord.createMany({
    data: newIds.map(questionId => ({
      userId,
      questionId,
      isCorrect:    false,
      isPending:    true,    // 待练，还没做过
      questionType: '',      // 从 question 表读，这里先留空
    })),
    skipDuplicates: true,
  })
  console.log(`[PracticePool] 写入 ${newIds.length} 道待练真题`)
}

// ── AnalysisQueue 触发 ─────────────────────────────────────────
async function triggerAnalysisQueue(importedQuestionIds: string[], examType: string) {
  const questions = await prisma.question.findMany({
    where:  { id: { in: importedQuestionIds } },
    select: { type: true, subtype: true },
  })
  const tagSet = new Set<string>()
  questions.forEach(q => { tagSet.add(q.type); if (q.subtype) tagSet.add(q.subtype) })

  const stats = await prisma.examTopicStats.findMany({
    where:  { examType, skillTag: { in: Array.from(tagSet) } },
    select: { skillTag: true, frequency: true },
  })
  const freqMap = new Map(stats.map(s => [s.skillTag, s.frequency]))

  const existing = await prisma.$queryRawUnsafe<Array<{ targetId: string }>>(
    `SELECT "targetId" FROM analysis_queue
     WHERE "targetType"='skill_tag' AND status IN ('pending','processing','done')
     AND "targetId" = ANY($1::text[])`,
    Array.from(tagSet)
  )
  const existingIds = new Set(existing.map(e => e.targetId))
  const newTasks = Array.from(tagSet)
    .filter(tag => !existingIds.has(tag))
    .map(tag => ({ triggeredBy:'import', targetType:'skill_tag', targetId:tag, priority: freqMap.get(tag) ?? 0.3, status:'pending', targetMeta: JSON.stringify({ examType }) }))

  if (newTasks.length > 0) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO analysis_queue ("id","triggeredBy","targetType","targetId","priority","status","targetMeta","createdAt","updatedAt")
      SELECT gen_random_uuid()::text, t."triggeredBy", t."targetType", t."targetId",
             t."priority"::float, t."status", t."targetMeta", NOW(), NOW()
      FROM jsonb_to_recordset($1::jsonb) AS t(
        "triggeredBy" text, "targetType" text, "targetId" text,
        "priority" text, "status" text, "targetMeta" text
      )
    `, JSON.stringify(newTasks))
  }
}
