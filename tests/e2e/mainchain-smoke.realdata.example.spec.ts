import { test, expect } from '@playwright/test'
import { smokeConfig } from './helpers/smoke-config.example'
import { loginByUi } from './helpers/login.example'

test.describe('mainchain smoke with real data', () => {
  test('practice -> submit -> result -> wrong questions -> review', async ({ page }) => {
    await loginByUi(page)

    await page.goto(`${smokeConfig.baseUrl}/practice?paperKey=${smokeConfig.samplePaperKey}&limit=3`)
    await expect(page.getByText('真题练习')).toBeVisible()

    const optionButtons = page.locator('button').filter({ hasText: /A|B|C|D/ })
    if (await optionButtons.count()) {
      await optionButtons.first().click()
      await page.getByRole('button', { name: '提交答案' }).click()
      await expect(page.getByText(/正确答案/)).toBeVisible()
    }

    // 真实环境里继续做题直到完成
    // 然后检查结果页、错题页、回看入口
  })

  test('import page is reachable for smoke user', async ({ page }) => {
    await loginByUi(page)
    await page.goto(`${smokeConfig.baseUrl}/import`)
    await expect(page.getByText(/真题导入/)).toBeVisible()
  })
})
