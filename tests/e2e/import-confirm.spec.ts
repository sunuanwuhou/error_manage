import { expect, test } from '@playwright/test'
import { createPrismaClient, cleanupImportedQuestions, prepareAdminBaseline, signInAndNormalize } from './helpers'

const prisma = createPrismaClient()

function makeImportPayload(runId: string) {
  const uniqueSession = `E2E Import ${runId}`
  const uniqueType = `E2E-考点-${runId}`
  const questions = [
    {
      index: 0,
      no: '1',
      content: `${uniqueSession} question 1 content`,
      options: ['A. one', 'B. two', 'C. three', 'D. four'],
      answer: 'A',
      type: uniqueType,
      analysis: 'analysis 1',
      examType: 'guo_kao',
      srcName: uniqueSession,
    },
    {
      index: 1,
      no: '2',
      content: `${uniqueSession} question 2 content`,
      options: ['A. five', 'B. six', 'C. seven', 'D. eight'],
      answer: 'B',
      type: uniqueType,
      analysis: 'analysis 2',
      examType: 'guo_kao',
      srcName: uniqueSession,
    },
  ]

  return {
    uniqueSession,
    uniqueType,
    payload: Buffer.from(JSON.stringify(questions)).toString('base64'),
  }
}

test.describe('import confirm regression', () => {
  test.beforeEach(async () => {
    await prepareAdminBaseline(prisma)
  })

  test.afterEach(async () => {
    await prisma.analysisQueue.deleteMany({ where: { targetId: { startsWith: 'E2E-考点-' } } })
    await prisma.examTopicStats.deleteMany({ where: { skillTag: { startsWith: 'E2E-考点-' } } })
    await prisma.practiceRecord.deleteMany({
      where: {
        question: {
          srcExamSession: { startsWith: 'E2E Import' },
        },
      },
    })
    await prisma.userError.deleteMany({
      where: {
        question: {
          srcExamSession: { startsWith: 'E2E Import' },
        },
      },
    })
    await prisma.question.deleteMany({ where: { srcExamSession: { startsWith: 'E2E Import' } } })
    await prepareAdminBaseline(prisma)
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test('respects preview selection when confirming import', async ({ page }) => {
    await signInAndNormalize(page)
    const { payload, uniqueSession, uniqueType } = makeImportPayload(String(Date.now()))

    const response = await page.request.post('/api/import/confirm', {
      data: {
        payload,
        srcYear: '2025',
        srcProvince: '北京',
        srcSession: uniqueSession,
        duplicateMode: 'skip',
        selected: [0],
      },
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toMatchObject({ imported: 1, skipped: 0, overwritten: 0, total: 1 })

    const questions = await prisma.question.findMany({
      where: { srcExamSession: uniqueSession },
      select: { id: true },
    })
    expect(questions).toHaveLength(1)

    await cleanupImportedQuestions(prisma, uniqueSession, uniqueType)
  })

  test('does not import anything when every preview item is deselected', async ({ page }) => {
    await signInAndNormalize(page)
    const { payload, uniqueSession, uniqueType } = makeImportPayload(String(Date.now()))

    const response = await page.request.post('/api/import/confirm', {
      data: {
        payload,
        srcYear: '2025',
        srcProvince: '北京',
        srcSession: uniqueSession,
        duplicateMode: 'skip',
        selected: [],
      },
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toMatchObject({ imported: 0, skipped: 0, overwritten: 0, total: 0 })

    const questions = await prisma.question.findMany({
      where: { srcExamSession: uniqueSession },
      select: { id: true },
    })
    expect(questions).toHaveLength(0)

    await cleanupImportedQuestions(prisma, uniqueSession, uniqueType)
  })

  test('replace_low_quality overwrites weaker duplicates', async ({ page }) => {
    await signInAndNormalize(page)

    const runId = String(Date.now())
    const uniqueSession = `E2E Import ${runId}`
    const uniqueType = `E2E-考点-${runId}`
    const imageSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#dbeafe"/><text x="60" y="44" text-anchor="middle" font-size="18" fill="#1d4ed8">IMG</text></svg>`
    const imageDataUrl = `data:image/svg+xml;base64,${Buffer.from(imageSvg).toString('base64')}`

    const existing = await prisma.question.create({
      data: {
        addedBy: 'system',
        content: `${uniqueSession} question 1 content`,
        options: JSON.stringify(['A. one', 'B. two', 'C. three', 'D. four']),
        answer: 'A',
        analysis: null,
        type: uniqueType,
        examType: 'guo_kao',
        srcExamSession: uniqueSession,
        srcQuestionNo: '1',
        srcQuestionOrder: 1,
        isFromOfficialBank: true,
        isPublic: true,
      },
    })

    const response = await page.request.post('/api/import/confirm', {
      data: {
        payload: Buffer.from(JSON.stringify([
          {
            index: 0,
            no: '1',
            content: `${uniqueSession} question 1 content`,
            questionImage: imageDataUrl,
            options: ['A. one', 'B. two', 'C. three', 'D. four'],
            answer: 'A',
            type: uniqueType,
            analysis: 'now with analysis',
            examType: 'guo_kao',
            srcName: uniqueSession,
          },
        ])).toString('base64'),
        srcYear: '2025',
        srcProvince: '北京',
        srcSession: uniqueSession,
        duplicateMode: 'replace_low_quality',
        selected: [0],
      },
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toMatchObject({ imported: 0, skipped: 0, overwritten: 1, total: 1 })

    const updated = await prisma.question.findUniqueOrThrow({
      where: { id: existing.id },
      select: { analysis: true, questionImage: true },
    })
    expect(updated.analysis).toBe('now with analysis')
    expect(updated.questionImage).toBe(imageDataUrl)

    await cleanupImportedQuestions(prisma, uniqueSession, uniqueType)
  })

  test('replace_low_quality overwrites an existing lower-quality duplicate', async ({ page }) => {
    await signInAndNormalize(page)
    const runId = String(Date.now())
    const uniqueSession = `E2E Import ${runId}`
    const uniqueType = `E2E-考点-${runId}`
    const examType = 'common'

    const existing = await prisma.question.create({
      data: {
        addedBy: 'system',
        content: `${uniqueSession} duplicate content`,
        options: JSON.stringify(['A.one', 'B.two']),
        answer: '',
        analysis: null,
        type: uniqueType,
        examType,
        srcExamSession: uniqueSession,
        srcQuestionNo: '1',
        srcQuestionOrder: 1,
        isFromOfficialBank: true,
        isPublic: true,
      },
      select: { id: true },
    })

    const payload = Buffer.from(JSON.stringify([
      {
        index: 0,
        no: '1',
        content: `${uniqueSession} duplicate content`,
        options: ['A.one', 'B.two', 'C.three', 'D.four'],
        answer: 'C',
        type: uniqueType,
        analysis: 'better analysis',
        examType,
        srcName: uniqueSession,
      },
    ])).toString('base64')

    const response = await page.request.post('/api/import/confirm', {
      data: {
        payload,
        srcYear: '2025',
        srcSession: uniqueSession,
        duplicateMode: 'replace_low_quality',
        selected: [0],
      },
    })
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data).toMatchObject({ imported: 0, skipped: 0, overwritten: 1, total: 1 })

    const updated = await prisma.question.findUnique({
      where: { id: existing.id },
      select: { options: true, answer: true, analysis: true },
    })
    expect(updated?.answer).toBe('C')
    expect(updated?.analysis).toBe('better analysis')
    expect(JSON.parse(updated?.options || '[]')).toEqual(['A.one', 'B.two', 'C.three', 'D.four'])

    await cleanupImportedQuestions(prisma, uniqueSession, uniqueType)
  })
})
