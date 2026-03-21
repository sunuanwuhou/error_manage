import { expect, test } from '@playwright/test'
import { createPrismaClient, resetAdminOnboardingState } from './helpers'

const prisma = createPrismaClient()

test.describe('login + onboarding smoke', () => {
  test.beforeEach(async () => {
    await resetAdminOnboardingState(prisma)
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test('can log in, complete onboarding, and reach the dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-username').fill('admin')
    await page.getByTestId('login-password').fill('changeme123')
    await page.getByTestId('login-submit').click()

    await page.waitForURL(/\/(dashboard|onboarding)(?:$|[?#])/, { timeout: 15_000 })
    if (!page.url().includes('/onboarding')) {
      await page.goto('/onboarding')
    }

    await expect(page.getByTestId('onboarding-step-1-next')).toBeVisible()
    await page.getByTestId('onboarding-step-1-next').click()
    await expect(page.getByTestId('onboarding-step-2-next')).toBeVisible()

    await page.getByTestId('onboarding-step-2-next').click()
    await expect(page.getByTestId('onboarding-submit')).toBeVisible()

    await page.getByTestId('onboarding-submit').click()
    await page.waitForURL(/\/dashboard(?:$|[?#])/, { timeout: 15_000 })
    await expect(page.getByText('Dashboard')).toBeVisible()
  })
})
