import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Pool } from 'pg'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

loadEnvFile(path.join(ROOT, '.env'))
loadEnvFile(path.join(ROOT, '.env.local'))

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL 未配置')
}

const pool = new Pool({ connectionString })

const args = parseArgs(process.argv.slice(2))

const PROFILES = {
  '常识判断': {
    reasonTag: '概念混淆',
    rootReason: '概念边界没分清',
    errorReason: '把相近政策或概念混在一起',
    actionRule: '看到分类题，先判作用对象再选',
  },
  '判断推理': {
    reasonTag: '方法不熟',
    rootReason: '规律识别不稳定',
    errorReason: '看到图形或逻辑关系时没有先定规则',
    actionRule: '看到推理题，先列规则再排选项',
  },
  '资料分析': {
    reasonTag: '审题粗心',
    rootReason: '指标和问法没对齐',
    errorReason: '把同比、比重、增长量混看',
    actionRule: '看到资料题，先圈指标再动笔',
  },
  '言语理解': {
    reasonTag: '关键词漏抓',
    rootReason: '主干信息没抓牢',
    errorReason: '选项判断前没先定位转折和主旨',
    actionRule: '看到言语题，先找主旨句再比选项',
  },
  '数量关系': {
    reasonTag: '方法不熟',
    rootReason: '条件转化速度太慢',
    errorReason: '公式和数量关系没有先结构化',
    actionRule: '看到数量题，先列条件关系再算',
  },
}

main()
  .catch((error) => {
    console.error('[seed-ai-evolution] fatal error', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })

async function main() {
  const userId = args.userId ?? 'wesly_local'
  const count = args.count ?? 24

  const userResult = await query(
    `SELECT id, username
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  )
  const user = userResult.rows[0]
  if (!user) {
    throw new Error(`user not found: ${userId}`)
  }

  const questionResult = await query(
    `SELECT id, type, subtype, content, answer
     FROM questions
     WHERE "isPublic" = true
     ORDER BY type ASC, COALESCE("srcQuestionOrder", 99999) ASC, "createdAt" ASC
     LIMIT $1`,
    [count]
  )

  let seededErrors = 0
  let seededReviews = 0
  let seededPractices = 0

  for (const [index, question] of questionResult.rows.entries()) {
    const profile = PROFILES[question.type] ?? PROFILES['判断推理']
    const myAnswer = pickWrongAnswer(question.answer)
    const reviewCount = 2 + (index % 3)
    const correctCount = index % 4 === 0 ? 1 : 0
    const masteryPercent = Math.max(10, 55 - index)
    const createdAt = new Date(Date.now() - (14 - (index % 10)) * 24 * 60 * 60 * 1000)
    const analyzedAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000)
    const lastReviewedAt = new Date(createdAt.getTime() + (index % 5) * 24 * 60 * 60 * 1000)
    const nextReviewAt = new Date(Date.now() - ((index % 3) - 1) * 24 * 60 * 60 * 1000)
    const isHot = masteryPercent <= 35
    const reboundAlert = index % 6 === 0

    const userErrorResult = await query(
      `INSERT INTO user_errors (
        id, "userId", "questionId", "myAnswer", "errorReason", "rootReason", "reasonTag",
        "aiRootReason", "aiErrorReason", "aiThinking", "aiReasonTag", "aiActionRule", "aiAnalyzedAt",
        "reviewCount", "correctCount", "masteryPercent", "isHot", "reboundAlert",
        "nextReviewAt", "lastReviewedAt", "masteryHistory", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, NOW()
      )
      ON CONFLICT ("userId", "questionId") DO UPDATE SET
        "myAnswer" = EXCLUDED."myAnswer",
        "errorReason" = EXCLUDED."errorReason",
        "rootReason" = EXCLUDED."rootReason",
        "reasonTag" = EXCLUDED."reasonTag",
        "aiRootReason" = EXCLUDED."aiRootReason",
        "aiErrorReason" = EXCLUDED."aiErrorReason",
        "aiThinking" = EXCLUDED."aiThinking",
        "aiReasonTag" = EXCLUDED."aiReasonTag",
        "aiActionRule" = EXCLUDED."aiActionRule",
        "aiAnalyzedAt" = EXCLUDED."aiAnalyzedAt",
        "reviewCount" = EXCLUDED."reviewCount",
        "correctCount" = EXCLUDED."correctCount",
        "masteryPercent" = EXCLUDED."masteryPercent",
        "isHot" = EXCLUDED."isHot",
        "reboundAlert" = EXCLUDED."reboundAlert",
        "nextReviewAt" = EXCLUDED."nextReviewAt",
        "lastReviewedAt" = EXCLUDED."lastReviewedAt",
        "masteryHistory" = EXCLUDED."masteryHistory",
        "updatedAt" = NOW()
      RETURNING id`,
      [
        userId,
        question.id,
        myAnswer,
        'AI 进化测试数据',
        profile.rootReason,
        profile.reasonTag,
        profile.rootReason,
        profile.errorReason,
        `${profile.actionRule}。先确认${question.type}的关键线索，再排除干扰项。`,
        profile.reasonTag,
        profile.actionRule,
        analyzedAt,
        reviewCount,
        correctCount,
        masteryPercent,
        isHot,
        reboundAlert,
        nextReviewAt,
        lastReviewedAt,
        JSON.stringify([
          { date: createdAt.toISOString(), mastery: Math.max(5, masteryPercent - 15) },
          { date: lastReviewedAt.toISOString(), mastery: masteryPercent },
        ]),
        createdAt,
      ]
    )

    const userErrorId = userErrorResult.rows[0].id
    seededErrors += 1

    const reviewTotal = await scalarInt(
      `SELECT COUNT(*)::int
       FROM review_records
       WHERE "userErrorId" = $1`,
      [userErrorId]
    )

    if (reviewTotal < 2) {
      for (let reviewIndex = reviewTotal; reviewIndex < 2; reviewIndex += 1) {
        const isCorrect = reviewIndex === 1 && correctCount > 0
        const createdAtReview = new Date(createdAt.getTime() + (reviewIndex + 1) * 24 * 60 * 60 * 1000)
        await query(
          `INSERT INTO review_records (
            id, "userId", "userErrorId", "isCorrect", "timeSpent", "isSlowCorrect",
            "thinkingVerdict", "thinkingFeedback", "resultMatrix", "createdAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4, $5,
            $6, $7, $8, $9
          )`,
          [
            userId,
            userErrorId,
            isCorrect,
            65 + index * 3,
            !isCorrect || reviewIndex === 0,
            isCorrect ? 'partial' : 'wrong',
            isCorrect ? '规则开始起效，但还不稳定。' : '仍然没有先按规则拆题。',
            JSON.stringify({
              stage: isCorrect ? 'improving' : 'repeat_error',
              source: 'seed-ai-evolution',
            }),
            createdAtReview,
          ]
        )
        seededReviews += 1
      }
    }

    await query(
      `INSERT INTO practice_records (
        id, "userId", "questionId", "isCorrect", "isPending", "nextShowAt", "questionType", "createdAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, false, $4, $5, $6
      )
      ON CONFLICT ("userId", "questionId") DO UPDATE SET
        "isCorrect" = EXCLUDED."isCorrect",
        "isPending" = EXCLUDED."isPending",
        "nextShowAt" = EXCLUDED."nextShowAt",
        "questionType" = EXCLUDED."questionType"`,
      [
        userId,
        question.id,
        correctCount > 0,
        nextReviewAt,
        question.type,
        createdAt,
      ]
    )
    seededPractices += 1
  }

  console.log(JSON.stringify({
    userId,
    seededErrors,
    seededReviews,
    seededPractices,
    sampledQuestions: questionResult.rows.length,
  }, null, 2))
}

function pickWrongAnswer(answer) {
  const letters = ['A', 'B', 'C', 'D']
  const normalized = String(answer || '').trim().toUpperCase()
  return letters.find((letter) => letter !== normalized) ?? 'B'
}

function parseArgs(argv) {
  const values = { userId: null, count: 24 }
  for (const arg of argv) {
    if (arg.startsWith('--userId=')) values.userId = arg.slice('--userId='.length)
    else if (arg.startsWith('--count=')) values.count = parseInt(arg.slice('--count='.length), 10)
  }
  return values
}

async function scalarInt(sql, params = []) {
  const result = await query(sql, params)
  return Number(result.rows[0]?.count ?? 0)
}

async function query(sql, params = []) {
  return pool.query(sql, params)
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    if (!key || key in process.env) continue
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
