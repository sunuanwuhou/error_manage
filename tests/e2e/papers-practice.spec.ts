import { expect, test } from '@playwright/test'
import { signInAndNormalize } from './helpers'

test.describe('paper practice smoke', () => {
  test('opens /papers and renders cards or empty state', async ({ page }) => {
    await signInAndNormalize(page)
    await page.goto('/papers')
    await expect(page.getByTestId('papers-page')).toBeVisible()

    const paperCards = page.getByTestId('paper-card')
    if (await paperCards.count()) {
      await expect(paperCards.first().getByTestId('paper-card-title')).toBeVisible()
      await expect(paperCards.first().getByTestId('paper-card-start')).toBeVisible()
      return
    }

    await expect(page.getByTestId('papers-empty')).toBeVisible()
  })

  test('enters paper practice page and answers at least one question', async ({ page }) => {
    await signInAndNormalize(page)
    await page.goto('/papers')

    const firstPaper = page.getByTestId('paper-card').first()
    if (!(await firstPaper.count())) {
      test.skip(true, 'No paper available in current test database')
    }

    await firstPaper.getByTestId('paper-card-start').click()
    await expect(page.getByTestId('paper-intro')).toBeVisible()
    await page.getByTestId('paper-intro-start-button').click()

    await expect(page.getByTestId('paper-practice-page')).toBeVisible()
    await expect(page.getByTestId('paper-question-content')).toBeVisible()
    const firstOption = page.getByTestId('paper-option').first()
    await expect(firstOption).toBeVisible()
    await firstOption.click()

    await page.waitForTimeout(300)
    await expect(page.getByTestId('paper-practice-page')).toBeVisible()
  })
})
