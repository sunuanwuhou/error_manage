import fs from 'node:fs'

import { expect, test } from '@playwright/test'

import { cleanupImportedSession, createPrismaClient, prepareAdminBaseline, signInAndNormalize } from './helpers'

const prisma = createPrismaClient()
const DOCX_FIXTURE = '/Users/10030299/Documents/个人/2022年国家公务员录用考试《行测》题（地市级网友回忆版）.docx'

test.describe('docx import flow', () => {
  test.beforeEach(async () => {
    await prepareAdminBaseline(prisma)
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test('supports docx-only preview -> confirm -> paper -> image question display', async ({ page }) => {
    if (!fs.existsSync(DOCX_FIXTURE)) {
      test.skip(true, `缺少 DOCX 样本：${DOCX_FIXTURE}`)
    }

    const uniqueSession = `DOCX E2E ${Date.now()}`

    try {
      await signInAndNormalize(page)
      await page.goto('/dashboard')
      await expect(page).toHaveURL(/\/dashboard(?:$|[?#])/)
      await page.goto('/import')

      await expect(page.getByRole('heading', { name: '导入真题' })).toBeVisible()
      await expect(page.getByText('当前主入口只支持 Word DOCX 导入')).toBeVisible()
      await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', '.docx')

      await page.getByRole('button', { name: '高级选项' }).click()
      await page.locator('select').first().selectOption('common')
      await page.getByPlaceholder('如：2024年国考行测').fill(uniqueSession)
      await page.locator('input[type="file"]').setInputFiles(DOCX_FIXTURE)

      await expect(page.getByRole('heading', { name: '解析预览' })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText('共 130 道题，展示前 50 道')).toBeVisible()
      await expect(page.getByRole('button', { name: '覆盖低质量旧题' })).toBeVisible()
      await expect(page.getByRole('button', { name: /确认导入 130 道题/ })).toBeVisible()

      await page.getByRole('button', { name: /确认导入 130 道题/ }).click()
      await expect(page.getByRole('heading', { name: '导入完成' })).toBeVisible({ timeout: 60_000 })
      const importedSummaryRow = page.locator('div').filter({ has: page.getByText('新入库题目') }).filter({ has: page.getByText('130 道') }).first()
      await expect(importedSummaryRow).toBeVisible()

      await page.goto('/papers')
      const paperCard = page.getByTestId('paper-card').filter({ has: page.getByText(uniqueSession) }).first()
      await expect(paperCard).toBeVisible({ timeout: 30_000 })
      await paperCard.getByTestId('paper-card-start').click()

      await expect(page.getByTestId('paper-intro')).toBeVisible()
      await page.getByTestId('paper-intro-start-button').click()
      await expect(page.getByTestId('paper-practice-page')).toBeVisible()

      await page.getByRole('button', { name: '61' }).click()
      await expect(page.getByTestId('paper-question-content')).toContainText('2/3')
      await expect(page.getByAltText('题目图片')).toBeVisible()

      await page.getByRole('button', { name: '71' }).click()
      await expect(page.getByAltText('题目图片')).toBeVisible()
      await expect(page.getByTestId('paper-option').first()).toContainText('A.见图')
    } finally {
      await cleanupImportedSession(prisma, uniqueSession)
    }
  })
})
