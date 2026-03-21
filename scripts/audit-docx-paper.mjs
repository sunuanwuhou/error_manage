import fs from 'node:fs'

const defaultLocalDb = process.env.DATABASE_URL_LOCAL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/wrongquestion'
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('supabase.co')) {
  process.env.DATABASE_URL = defaultLocalDb
}
if (!process.env.DIRECT_URL || process.env.DIRECT_URL.includes('supabase.co')) {
  process.env.DIRECT_URL = process.env.DIRECT_URL_LOCAL ?? process.env.DATABASE_URL
}

import { PrismaClient } from '@prisma/client'

import { parseDocxBuffer } from '../src/lib/parsers/docx-parser.ts'
import { inferPaperSourceMeta } from '../src/lib/paper-source.ts'

const prisma = new PrismaClient()

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function toOptions(value) {
  if (Array.isArray(value)) return value.map(item => normalizeText(item))
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(item => normalizeText(item)) : []
  } catch {
    return []
  }
}

function hasImage(value) {
  return Boolean(normalizeText(value))
}

function buildNoStats(nos) {
  const seen = new Set()
  const duplicate = new Set()
  for (const no of nos) {
    if (seen.has(no)) duplicate.add(no)
    seen.add(no)
  }

  const numeric = nos
    .map(item => Number(item))
    .filter(item => Number.isFinite(item))
    .sort((a, b) => a - b)

  const missing = []
  if (numeric.length > 0) {
    for (let n = numeric[0]; n <= numeric[numeric.length - 1]; n += 1) {
      if (!numeric.includes(n)) missing.push(String(n))
    }
  }

  return {
    duplicateNos: Array.from(duplicate),
    missingNos: missing,
  }
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) throw new Error('missing docx path')

  const fileName = inputPath.split(/[\\/]/).pop() || inputPath
  const meta = inferPaperSourceMeta({ fileName })
  const parsed = await parseDocxBuffer(fs.readFileSync(inputPath))
  const dbQuestions = await prisma.question.findMany({
    where: { srcExamSession: meta.srcName },
    select: {
      srcQuestionNo: true,
      content: true,
      type: true,
      answer: true,
      options: true,
      questionImage: true,
    },
  })

  const parsedByNo = new Map(parsed.questions.map(item => [String(item.no || ''), item]))
  const dbByNo = new Map(dbQuestions.map(item => [String(item.srcQuestionNo || ''), item]))

  const parsedNos = parsed.questions.map(item => String(item.no || ''))
  const dbNos = dbQuestions.map(item => String(item.srcQuestionNo || ''))
  const parsedNoStats = buildNoStats(parsedNos)
  const dbNoStats = buildNoStats(dbNos)

  const mismatches = []
  for (const [no, parsedQuestion] of parsedByNo.entries()) {
    const dbQuestion = dbByNo.get(no)
    if (!dbQuestion) {
      mismatches.push({ no, issues: ['missing_in_db'] })
      continue
    }

    const issues = []
    if (normalizeText(parsedQuestion.content) !== normalizeText(dbQuestion.content)) issues.push('content')
    if (normalizeText(parsedQuestion.type) !== normalizeText(dbQuestion.type)) issues.push('type')
    if (normalizeText(parsedQuestion.answer) !== normalizeText(dbQuestion.answer)) issues.push('answer')
    if (toOptions(parsedQuestion.options).join('|') !== toOptions(dbQuestion.options).join('|')) issues.push('options')
    if (hasImage(parsedQuestion.questionImage) !== hasImage(dbQuestion.questionImage)) issues.push('image')
    if (issues.length > 0) mismatches.push({ no, issues })
  }

  for (const no of dbByNo.keys()) {
    if (!parsedByNo.has(no)) {
      mismatches.push({ no, issues: ['extra_in_db'] })
    }
  }

  const parsedTypeStats = {}
  const dbTypeStats = {}
  for (const item of parsed.questions) parsedTypeStats[item.type] = (parsedTypeStats[item.type] || 0) + 1
  for (const item of dbQuestions) dbTypeStats[item.type] = (dbTypeStats[item.type] || 0) + 1

  const parsedWithImage = parsed.questions.filter(item => hasImage(item.questionImage)).length
  const dbWithImage = dbQuestions.filter(item => hasImage(item.questionImage)).length

  const parsedOptionsNonEmpty = parsed.questions.filter(item => toOptions(item.options).length > 0).length
  const dbOptionsNonEmpty = dbQuestions.filter(item => toOptions(item.options).length > 0).length

  const parsedAnswerNonEmpty = parsed.questions.filter(item => normalizeText(item.answer)).length
  const dbAnswerNonEmpty = dbQuestions.filter(item => normalizeText(item.answer)).length

  console.log(JSON.stringify({
    inputPath,
    meta,
    parsedTotal: parsed.questions.length,
    dbTotal: dbQuestions.length,
    noIntegrity: {
      parsed: parsedNoStats,
      db: dbNoStats,
    },
    typeDistribution: {
      parsed: parsedTypeStats,
      db: dbTypeStats,
    },
    completeness: {
      parsedWithImage,
      dbWithImage,
      parsedOptionsNonEmpty,
      dbOptionsNonEmpty,
      parsedAnswerNonEmpty,
      dbAnswerNonEmpty,
    },
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 100),
  }, null, 2))
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
