import { expect, test, type Page } from '@playwright/test'

const CREDENTIALS = [
  {
    username: process.env.E2E_USERNAME ?? 'admin',
    password: process.env.E2E_PASSWORD ?? 'changeme123',
  },
  {
    username: 'wesly',
    password: '748663',
  },
]

async function signInAndNormalize(page: Page) {
  for (const credential of CREDENTIALS) {
    await page.goto('/login')
    const usernameInput = page.locator('input[type="text"]').first()
    const passwordInput = page.locator('input[type="password"]').first()
    await expect(usernameInput).toBeVisible()
    await expect(passwordInput).toBeVisible()
    await usernameInput.fill(credential.username)
    await passwordInput.fill(credential.password)
    await page.getByRole('button', { name: '登录' }).click()

    try {
      await page.waitForURL(/\/(dashboard|onboarding)(?:$|[?#])/, { timeout: 12_000 })
    } catch {
      continue
    }

    if (page.url().includes('/onboarding')) {
      await page.getByTestId('onboarding-step-1-next').click()
      await page.getByTestId('onboarding-step-2-next').click()
      await page.getByTestId('onboarding-submit').click()
      try {
        await page.waitForURL(/\/dashboard(?:$|[?#])/, { timeout: 12_000 })
      } catch {
        const saveError = await page.locator('text=/保存失败|当前登录状态已过期|未登录/').textContent().catch(() => null)
        throw new Error(saveError ? `Onboarding save failed: ${saveError}` : 'Onboarding did not reach dashboard')
      }
    }

    if (page.url().includes('/dashboard')) {
      return
    }
  }

  throw new Error('Unable to sign in with the bundled smoke-test credentials')
}

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
