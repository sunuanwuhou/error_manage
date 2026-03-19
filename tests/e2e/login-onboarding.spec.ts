import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function resetAdminOnboardingState() {
  await prisma.user.update({
    where: { username: 'admin' },
    data: {
      examType: 'guo_kao',
      targetScore: 85,
      dailyGoal: 70,
      targetProvince: null,
      examDate: null,
      onboardingCompletedAt: null,
      isActive: true,
      passwordExpireAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  })
}

test.describe('login + onboarding smoke', () => {
  test.beforeEach(async () => {
    await resetAdminOnboardingState()
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

    await expect(page.getByRole('heading', { name: '你参加哪类考试？' })).toBeVisible()

    await page.getByTestId('onboarding-step-1-next').click()
    await expect(page.getByRole('heading', { name: '设定目标' })).toBeVisible()

    await page.getByTestId('onboarding-step-2-next').click()
    await expect(page.getByRole('heading', { name: '每日目标题数' })).toBeVisible()
    await expect(page.getByText('70 道')).toBeVisible()

    await page.getByTestId('onboarding-submit').click()

    await page.waitForURL(/\/dashboard(?:$|[?#])/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: '今日任务' })).toBeVisible()
  })
})
