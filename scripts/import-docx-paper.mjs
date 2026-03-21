import fs from 'node:fs'

import { PrismaClient } from '@prisma/client'

import { parseDocxBuffer } from '../src/lib/parsers/docx-parser.ts'
import { inferPaperSourceMeta } from '../src/lib/paper-source.ts'

const prisma = new PrismaClient()

function inferPaperQuestionOrder(srcQuestionNo) {
  if (!srcQuestionNo) return null
  const exact = srcQuestionNo.trim().match(/^\d+$/)
  if (exact) return Number(exact[0])
  const firstDigit = srcQuestionNo.match(/\d+/)
  return firstDigit ? Number(firstDigit[0]) : null
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    throw new Error('missing docx path')
  }

  const fileName = inputPath.split('/').pop() || inputPath
  const meta = inferPaperSourceMeta({ fileName })
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, username: true },
  })

  if (!admin) {
    throw new Error('missing admin user')
  }

  const parsed = await parseDocxBuffer(fs.readFileSync(inputPath))

  let created = 0
  let updated = 0

  for (let index = 0; index < parsed.questions.length; index += 1) {
    const question = parsed.questions[index]
    const srcQuestionNo = question.no?.trim() || null
    const srcQuestionOrder = inferPaperQuestionOrder(srcQuestionNo) ?? (index + 1)
    const existing = await prisma.question.findFirst({
      where: {
        srcExamSession: meta.srcName,
        srcQuestionNo,
        examType: meta.examType || 'common',
      },
      select: { id: true },
    })

    const data = {
      addedBy: admin.id,
      content: question.content,
      questionImage: question.questionImage || null,
      options: JSON.stringify(question.options),
      answer: question.answer || '',
      analysis: question.analysis || null,
      type: question.type,
      examType: meta.examType || 'common',
      srcYear: meta.srcYear || null,
      srcProvince: meta.srcProvince || null,
      srcExamSession: meta.srcName,
      srcOrigin: 'file_import',
      srcQuestionNo,
      srcQuestionOrder,
      isFromOfficialBank: true,
      isPublic: true,
    }

    if (existing) {
      await prisma.question.update({
        where: { id: existing.id },
        data,
      })
      updated += 1
      continue
    }

    await prisma.question.create({ data })
    created += 1
  }

  const persisted = await prisma.question.findMany({
    where: { srcExamSession: meta.srcName },
    select: {
      id: true,
      srcExamSession: true,
      srcYear: true,
      srcProvince: true,
      examType: true,
      srcQuestionNo: true,
      type: true,
      questionImage: true,
    },
    orderBy: { srcQuestionOrder: 'asc' },
  })

  console.log(JSON.stringify({
    meta,
    admin,
    totalParsed: parsed.questions.length,
    created,
    updated,
    persisted: persisted.length,
    withImage: persisted.filter(item => item.questionImage).length,
    first: persisted.slice(0, 3),
    last: persisted.slice(-3),
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
