import fs from 'node:fs'

import { PrismaClient } from '@prisma/client'

import { parseDocxBuffer } from '../src/lib/parsers/docx-parser.ts'
import { inferPaperSourceMeta } from '../src/lib/paper-source.ts'

const prisma = new PrismaClient()

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeOptions(value) {
  const options = Array.isArray(value)
    ? value
    : (() => {
        try {
          const parsed = JSON.parse(value || '[]')
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })()
  return options.map(item => normalizeText(item))
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) throw new Error('missing docx path')

  const fileName = inputPath.split('/').pop() || inputPath
  const meta = inferPaperSourceMeta({ fileName })
  const parsed = await parseDocxBuffer(fs.readFileSync(inputPath))
  const dbQuestions = await prisma.question.findMany({
    where: {
      srcExamSession: meta.srcName,
    },
    select: {
      srcQuestionNo: true,
      content: true,
      type: true,
      answer: true,
      options: true,
      questionImage: true,
    },
  })

  const dbByNo = new Map(dbQuestions.map(item => [String(item.srcQuestionNo || ''), item]))
  const missing = []
  const mismatches = []
  const parsedWithImage = parsed.questions.filter(item => item.questionImage).length
  const dbWithImage = dbQuestions.filter(item => item.questionImage).length

  for (const question of parsed.questions) {
    const key = String(question.no || '')
    const dbQuestion = dbByNo.get(key)
    if (!dbQuestion) {
      missing.push(key)
      continue
    }

    const issues = []
    if (normalizeText(question.content) !== normalizeText(dbQuestion.content)) issues.push('content')
    if (normalizeText(question.type) !== normalizeText(dbQuestion.type)) issues.push('type')
    if (normalizeText(question.answer) !== normalizeText(dbQuestion.answer)) issues.push('answer')

    const parsedOptions = normalizeOptions(question.options)
    const dbOptions = normalizeOptions(dbQuestion.options)
    if (parsedOptions.join('|') !== dbOptions.join('|')) issues.push('options')
    if (Boolean(question.questionImage) !== Boolean(dbQuestion.questionImage)) issues.push('image')

    if (issues.length > 0) {
      mismatches.push({
        no: key,
        issues,
      })
    }
  }

  const extra = dbQuestions
    .map(item => String(item.srcQuestionNo || ''))
    .filter(no => !parsed.questions.some(item => String(item.no || '') === no))

  console.log(JSON.stringify({
    meta,
    parsedTotal: parsed.questions.length,
    dbTotal: dbQuestions.length,
    parsedWithImage,
    dbWithImage,
    missing,
    extra,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 20),
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
