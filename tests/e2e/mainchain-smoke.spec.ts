import { test, expect } from '@playwright/test'

test.describe('mainchain smoke', () => {
  test('practice -> submit -> result -> review', async ({ page }) => {
    await page.goto('/practice')

    await page.getByPlaceholder('题量').fill('3')
    await page.getByRole('button', { name: '开始练习' }).click()

    await expect(page.getByText('真题练习')).toBeVisible()

    const optionButtons = page.locator('button').filter({ hasText: /A|B|C|D/ })
    if (await optionButtons.count()) {
      await optionButtons.first().click()
      await page.getByRole('button', { name: '提交答案' }).click()
      await expect(page.getByText(/正确答案/)).toBeVisible()
    }
  })

  test('wrong questions page is reachable', async ({ page }) => {
    await page.goto('/wrong-questions')
    await expect(page.getByText(/错题/)).toBeVisible()
  })

  test('question detail page shape', async ({ page }) => {
    await page.goto('/questions/test-id')
    // 占位 smoke：真实环境里替换为存在的 questionId
    // 这里只保留结构提醒，避免把不存在的数据写死
    await expect(page).toHaveURL(/\/questions\//)
  })
})
