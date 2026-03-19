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
})
