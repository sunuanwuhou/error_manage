import { expect, test } from '@playwright/test'
import { createPrismaClient, prepareAdminBaseline, signInAndNormalize } from './helpers'

const prisma = createPrismaClient()

test.describe('settings save regression', () => {
  test.beforeEach(async () => {
    await prepareAdminBaseline(prisma)
  })

  test.afterEach(async () => {
    await prepareAdminBaseline(prisma)
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test('saves exam configuration and preserves the saved summary', async ({ page }) => {
    await signInAndNormalize(page)

    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
    await expect(page.getByText(/目标分 85 · 每日 70 题/)).toBeVisible()

    await page.getByRole('button', { name: '修改', exact: true }).click()
    await page.locator('label:has-text("目标分") + input[type="number"]').fill('92')
    await page.locator('label:has-text("每日目标题数") + select').selectOption('100')

    await page.getByRole('button', { name: '保存配置' }).click()
    await expect(page.getByText('保存成功')).toBeVisible()

    await page.reload()
    await expect(page.getByText(/目标分 92 · 每日 100 题/)).toBeVisible()
  })
})
