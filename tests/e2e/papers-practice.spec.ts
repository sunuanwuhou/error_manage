import { expect, test } from '@playwright/test'
import { signInAndNormalize } from './helpers'

test.describe('paper practice smoke', () => {
  test('opens /papers and renders either paper cards or a clear empty state', async ({ page }) => {
    await signInAndNormalize(page)

    await page.goto('/papers')
    await expect(page.getByTestId('papers-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: '套卷练习' })).toBeVisible()

    const paperCards = page.getByTestId('paper-card')
    const cardCount = await paperCards.count()

    if (cardCount > 0) {
      await expect(paperCards.first().getByTestId('paper-card-title')).toBeVisible()
      await expect(paperCards.first().getByTestId('paper-card-start')).toBeVisible()
      return
    }

    await expect(page.getByText(/还没有可练的套卷|没有符合当前筛选的套卷/)).toBeVisible()
  })

  test('enters a paper practice page and renders the key question content', async ({ page }) => {
    await signInAndNormalize(page)

    await page.goto('/papers')
    const firstPaper = page.getByTestId('paper-card').first()
    if (await firstPaper.count() === 0) {
      test.skip(true, '当前测试数据库没有可练套卷，跳过进入练习页校验')
    }
    await expect(firstPaper).toBeVisible()

    await firstPaper.getByTestId('paper-card-start').click()
    await expect(page.getByTestId('paper-intro')).toBeVisible()
    await expect(page.getByTestId('paper-intro-title')).toBeVisible()
    await page.getByTestId('paper-intro-start-button').click()

    await expect(page.getByTestId('paper-practice-page')).toBeVisible()
    await expect(page.getByTestId('paper-question-content')).toBeVisible()
    await expect(page.getByTestId('paper-option').first()).toBeVisible()
  })
})
