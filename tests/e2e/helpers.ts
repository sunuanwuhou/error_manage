import { PrismaClient } from '@prisma/client'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'

const ADMIN_CREDENTIALS = {
  username: process.env.E2E_USERNAME ?? 'admin',
  password: process.env.E2E_PASSWORD ?? 'changeme123',
}

export function createPrismaClient() {
  return new PrismaClient()
}

async function ensureAdminUser(prisma: PrismaClient, onboardingCompleted: boolean) {
  const passwordHash = await bcrypt.hash(ADMIN_CREDENTIALS.password, 10)
  const now = new Date()
  const passwordExpireAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

  await prisma.user.upsert({
    where: { username: ADMIN_CREDENTIALS.username },
    update: {
      passwordHash,
      role: 'admin',
      examType: 'guo_kao',
      targetScore: 85,
      dailyGoal: 70,
      targetProvince: null,
      examDate: null,
      onboardingCompletedAt: onboardingCompleted ? now : null,
      isActive: true,
      passwordExpireAt,
    },
    create: {
      username: ADMIN_CREDENTIALS.username,
      passwordHash,
      role: 'admin',
      examType: 'guo_kao',
      targetScore: 85,
      dailyGoal: 70,
      targetProvince: null,
      examDate: null,
      onboardingCompletedAt: onboardingCompleted ? now : null,
      isActive: true,
      passwordExpireAt,
    },
  })
}

export async function resetAdminOnboardingState(prisma: PrismaClient) {
  await ensureAdminUser(prisma, false)
}

export async function prepareAdminBaseline(prisma: PrismaClient) {
  await ensureAdminUser(prisma, true)
}

export async function signInAndNormalize(page: Page) {
  for (const credential of [
    ADMIN_CREDENTIALS,
    { username: 'wesly', password: '748663' },
  ]) {
    const usernameInput = page.getByTestId('login-username')
    const passwordInput = page.getByTestId('login-password')
    const submitButton = page.getByTestId('login-submit')

    let loginReady = false
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto('/login')
      try {
        await usernameInput.waitFor({ state: 'visible', timeout: 10_000 })
        await passwordInput.waitFor({ state: 'visible', timeout: 10_000 })
        loginReady = true
        break
      } catch {
        if (attempt === 2) {
          throw new Error('login page did not become ready in time')
        }
      }
    }

    if (!loginReady) {
      continue
    }

    await usernameInput.fill(credential.username)
    await passwordInput.fill(credential.password)

    await page.waitForFunction(
      ([u, p]) => {
        const userEl = document.querySelector('[data-testid="login-username"]') as HTMLInputElement | null
        const passEl = document.querySelector('[data-testid="login-password"]') as HTMLInputElement | null
        return !!userEl && !!passEl && userEl.value === u && passEl.value === p
      },
      [credential.username, credential.password],
      { timeout: 5_000 },
    )

    await submitButton.click()

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

export async function cleanupImportedSession(
  prisma: PrismaClient,
  sourceSession: string,
) {
  const questions = await prisma.question.findMany({
    where: { srcExamSession: sourceSession },
    select: { id: true, type: true },
  })

  if (questions.length === 0) return

  const questionIds = questions.map(q => q.id)
  const skillTags = Array.from(new Set(questions.map(q => q.type).filter(Boolean)))
  await prisma.practiceRecord.deleteMany({ where: { questionId: { in: questionIds } } })
  await prisma.userError.deleteMany({ where: { questionId: { in: questionIds } } })
  await prisma.analysisQueue.deleteMany({ where: { targetId: { in: skillTags } } })
  await prisma.examTopicStats.deleteMany({ where: { skillTag: { in: skillTags } } })
  await prisma.question.deleteMany({ where: { id: { in: questionIds } } })
}

export function resolveExistingFixturePath(candidates: string[]) {
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}
