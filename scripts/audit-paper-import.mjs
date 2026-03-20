import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { parseExcelBuffer } from '../src/lib/parsers/excel-parser.ts'
import { qualityCheck } from '../src/lib/import/duplicate-policy.ts'

const prisma = new PrismaClient()

const FILE_PATH = '/Users/10030299/Documents/个人/2022年国家公务员录用考试《行测》题（地市级网友回忆版）.xlsx'
const SESSION = '2022年国家公务员录用考试《行测》题（地市级网友回忆版）'

function parseOptions(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : []
  } catch {
    return []
  }
}

function compact(text, size = 48) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, size)
}

const buffer = fs.readFileSync(FILE_PATH)
const parsed = await parseExcelBuffer(buffer)
const dbRows = await prisma.question.findMany({
  where: {
    isFromOfficialBank: true,
    srcExamSession: SESSION,
  },
  select: {
    id: true,
    srcQuestionNo: true,
    type: true,
    content: true,
    questionImage: true,
    options: true,
    answer: true,
    analysis: true,
  },
  orderBy: [{ srcQuestionOrder: 'asc' }, { id: 'asc' }],
})

const dbByNo = new Map(dbRows.map((row) => [String(row.srcQuestionNo || ''), row]))

const audit = parsed.questions.map((q) => {
  const db = dbByNo.get(q.no)
  const dbOptions = parseOptions(db?.options)
  const diff = []

  if (!db) diff.push('missing_in_db')
  if (db && db.type !== q.type) diff.push('type_mismatch')
  if (db && db.content !== q.content) diff.push('content_mismatch')
  if (db && JSON.stringify(dbOptions) !== JSON.stringify(q.options)) diff.push('options_mismatch')
  if (db && Boolean(db.questionImage) !== Boolean(q.questionImage)) diff.push('image_mismatch')
  if (db && (db.answer || '') !== (q.answer || '')) diff.push('answer_mismatch')

  const quality = qualityCheck(q)
  return {
    no: q.no,
    type: q.type,
    hasImage: Boolean(q.questionImage),
    issues: quality.issues,
    diff,
    preview: compact(q.content),
  }
})

const missingInSource = dbRows
  .map((row) => String(row.srcQuestionNo || ''))
  .filter((no) => !parsed.questions.some((q) => q.no === no))

console.log(JSON.stringify({
  totalSource: parsed.questions.length,
  totalDb: dbRows.length,
  mismatchCount: audit.filter((item) => item.diff.length > 0).length,
  qualityIssueCount: audit.filter((item) => item.issues.length > 0).length,
  missingInSource,
  mismatches: audit.filter((item) => item.diff.length > 0),
  qualityIssues: audit.filter((item) => item.issues.length > 0),
}, null, 2))

await prisma.$disconnect()
