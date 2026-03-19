import { PrismaClient } from '@prisma/client'
import type { Page } from '@playwright/test'

const ADMIN_CREDENTIALS = {
  username: process.env.E2E_USERNAME ?? 'admin',
  password: process.env.E2E_PASSWORD ?? 'changeme123',
}

export function createPrismaClient() {
  return new PrismaClient()
}

export async function resetAdminOnboardingState(prisma: PrismaClient) {
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

export async function prepareAdminBaseline(prisma: PrismaClient) {
  await prisma.user.update({
    where: { username: 'admin' },
    data: {
      examType: 'guo_kao',
      targetScore: 85,
      dailyGoal: 70,
      targetProvince: null,
      examDate: null,
      onboardingCompletedAt: new Date(),
      isActive: true,
      passwordExpireAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  })
}

export async function signInAndNormalize(page: Page) {
  for (const credential of [
    ADMIN_CREDENTIALS,
    { username: 'wesly', password: '748663' },
  ]) {
    await page.goto('/login')
    const usernameInput = page.locator('input[type="text"]').first()
    const passwordInput = page.locator('input[type="password"]').first()
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
      await page.waitForURL(/\/dashboard(?:$|[?#])/, { timeout: 12_000 })
    }

    if (page.url().includes('/dashboard')) {
      return
    }
  }

  throw new Error('Unable to sign in with the bundled smoke-test credentials')
}

export async function cleanupImportedQuestions(
  prisma: PrismaClient,
  sourceSession: string,
  uniqueType: string,
) {
  const questions = await prisma.question.findMany({
    where: { srcExamSession: sourceSession },
    select: { id: true },
  })

  if (questions.length === 0) return

  const questionIds = questions.map(q => q.id)
  await prisma.practiceRecord.deleteMany({ where: { questionId: { in: questionIds } } })
  await prisma.userError.deleteMany({ where: { questionId: { in: questionIds } } })
  await prisma.analysisQueue.deleteMany({ where: { targetId: uniqueType } })
  await prisma.examTopicStats.deleteMany({ where: { skillTag: uniqueType } })
  await prisma.question.deleteMany({ where: { id: { in: questionIds } } })
}
