import { expect, test } from '@playwright/test'

import {
  cleanupImportedSession,
  createPrismaClient,
  prepareAdminBaseline,
  resolveExistingFixturePath,
  signInAndNormalize,
} from './helpers'

const prisma = createPrismaClient()
const PDF_FIXTURE = resolveExistingFixturePath([
  process.env.E2E_IMPORT_PDF_FIXTURE ?? '',
  'C:\\Users\\USER\\Desktop\\错题系统\\2025年广东省考试录用公务员《行政执法专业》试卷（考生回忆版）.pdf',
].filter(Boolean))

test.describe('pdf import flow', () => {
  test.beforeEach(async () => {
    await prepareAdminBaseline(prisma)
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test('supports pdf preview -> confirm -> paper list flow', async ({ page }) => {
    if (!PDF_FIXTURE) {
      test.skip(true, '缺少可用 PDF 样本，请配置 E2E_IMPORT_PDF_FIXTURE 或放入桌面错题系统目录')
    }

    const uniqueSession = `PDF E2E ${Date.now()}`

    try {
      await signInAndNormalize(page)
      await page.goto('/import')

      await expect(page.getByRole('heading', { name: '瀵煎叆鐪熼' })).toBeVisible()
      await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', '.pdf,.docx')

      await page.getByRole('button', { name: '楂樼骇閫夐項' }).click()
      await page.locator('select').first().selectOption('common')
      await page.getByPlaceholder('濡傦細2024骞村浗鑰冭娴?').fill(uniqueSession)
      await page.locator('input[type="file"]').setInputFiles(PDF_FIXTURE)

      await expect(page.getByRole('heading', { name: '瑙ｆ瀽棰勮' })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText(/PDF/)).toBeVisible()
      await expect(page.getByRole('button', { name: /纭瀵煎叆/ })).toBeVisible()

      await page.getByRole('button', { name: /纭瀵煎叆/ }).click()
      await expect(page.getByRole('heading', { name: '瀵煎叆瀹屾垚' })).toBeVisible({ timeout: 60_000 })

      await page.goto('/papers')
      const paperCard = page.getByTestId('paper-card').filter({ has: page.getByText(uniqueSession) }).first()
      await expect(paperCard).toBeVisible({ timeout: 30_000 })
      await paperCard.getByTestId('paper-card-start').click()

      await expect(page.getByTestId('paper-intro')).toBeVisible()
      await page.getByTestId('paper-intro-start-button').click()
      await expect(page.getByTestId('paper-practice-page')).toBeVisible()
      await expect(page.getByTestId('paper-question-content')).toBeVisible()
    } finally {
      await cleanupImportedSession(prisma, uniqueSession)
    }
  })
})
