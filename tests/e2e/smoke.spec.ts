import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { inferPaperSourceMeta } from '@/lib/paper-source'
import { createPrismaClient, cleanupImportedSession, prepareAdminBaseline, resetAdminOnboardingState, resetUserWorkspace, resolveExistingFixturePath } from './helpers'

const prisma = createPrismaClient()
const ADMIN_USERNAME = process.env.E2E_USERNAME ?? 'admin'
const DOCX_FIXTURE = resolveExistingFixturePath([
  process.env.E2E_IMPORT_DOCX_FIXTURE ?? '',
  '/Users/10030299/Documents/个人/2025年广东省公务员录用考试《行测》题（网友回忆版）.docx',
  '/Users/10030299/Documents/个人/2024年广东省公务员录用考试《行测》题（网友回忆版）.docx',
  'C:\\Users\\USER\\Desktop\\错题系统\\word版本\\广东省考\\2025年广东省公务员录用考试《行测》题（网友回忆版）.docx',
  'C:\\Users\\USER\\Desktop\\错题系统\\word版本\\广东省考\\2024年广东省公务员录用考试《行测》题（网友回忆版）.docx',
].filter(Boolean))

async function getAdminId() {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { username: ADMIN_USERNAME },
    select: { id: true },
  })
  return admin.id
}

async function prepareSmokeWorkspace(onboardingCompleted: boolean) {
  if (onboardingCompleted) {
    await prepareAdminBaseline(prisma)
  } else {
    await resetAdminOnboardingState(prisma)
  }

  const adminId = await getAdminId()
  await resetUserWorkspace(prisma, adminId)
  return adminId
}

async function authenticateAdmin(page: Page) {
  await page.goto('/login')
  await expect(page.getByTestId('login-username')).toBeVisible()
  await page.getByTestId('login-username').fill('admin')
  await page.getByTestId('login-password').fill('changeme123')
  await page.getByTestId('login-submit').click()

  await expect(page).toHaveURL(/\/(dashboard|onboarding)(?:$|[?#])/, { timeout: 15_000 })
}

async function seedSinglePracticeQuestion(adminId: string) {
  const question = await prisma.question.findFirst({
    where: { isPublic: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, type: true },
  })

  if (!question) {
    throw new Error('no public question found for practice smoke')
  }

  await prisma.practiceRecord.upsert({
    where: {
      userId_questionId: {
        userId: adminId,
        questionId: question.id,
      },
    },
    update: {
      isPending: true,
      isCorrect: false,
      nextShowAt: new Date(),
      questionType: question.type,
    },
    create: {
      userId: adminId,
      questionId: question.id,
      isPending: true,
      isCorrect: false,
      nextShowAt: new Date(),
      questionType: question.type,
    },
  })
}

test.describe.serial('app smoke', () => {
  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test('login and onboarding can complete the first-time flow', async ({ page }) => {
    await prepareSmokeWorkspace(false)

    await authenticateAdmin(page)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/(dashboard|onboarding)(?:$|[?#])/, { timeout: 15_000 })
    if (page.url().includes('/onboarding')) {
      await expect(page.getByTestId('onboarding-step-1-next')).toBeVisible()
      await page.getByTestId('onboarding-step-1-next').click()
      await expect(page.getByTestId('onboarding-step-2-next')).toBeVisible()
      await page.getByTestId('onboarding-step-2-next').click()
      await expect(page.getByTestId('onboarding-submit')).toBeVisible()
      await page.getByTestId('onboarding-submit').click()
      await page.waitForURL(/\/dashboard(?:$|[?#])/, { timeout: 15_000 })
    }
    await expect(page.getByText('Dashboard')).toBeVisible()
  })

  test('import upload -> preview -> confirm works end-to-end', async ({ page }) => {
    await prepareSmokeWorkspace(true)
    await authenticateAdmin(page)
    await page.goto('/dashboard')

    if (!DOCX_FIXTURE) {
      test.skip(true, 'Missing local docx fixture for import smoke')
    }

    const uniqueSession = inferPaperSourceMeta({
      fileName: path.basename(DOCX_FIXTURE!),
    }).srcName || path.basename(DOCX_FIXTURE!).replace(/\.[^.]+$/, '')

    try {
      await page.goto('/import')
      await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', '.docx')
      await page.getByRole('button', { name: '高级选项' }).click()
      await page.getByPlaceholder('如：2024年国考行测').fill(uniqueSession)

      const uploadResponsePromise = page.waitForResponse(res => res.url().includes('/api/import/upload') && res.request().method() === 'POST')
      await page.locator('input[type="file"]').setInputFiles(DOCX_FIXTURE!)
      const uploadResponse = await uploadResponsePromise
      expect(uploadResponse.ok()).toBeTruthy()

      const uploadData = await uploadResponse.json()
      expect(uploadData.total).toBeGreaterThan(0)
      await expect(page.getByText('解析预览')).toBeVisible()
      await expect(page.getByRole('button', { name: /确认导入/ })).toBeVisible()
      await page.getByRole('button', { name: /确认导入/ }).click()

      await expect(page.getByText('导入完成')).toBeVisible()
    } finally {
      await cleanupImportedSession(prisma, uniqueSession)
    }
  })

  test('paper list -> enter practice -> summary works', async ({ page }) => {
    await prepareSmokeWorkspace(true)
    await authenticateAdmin(page)
    await page.goto('/dashboard')

    await page.goto('/papers')
    await expect(page.getByTestId('papers-page')).toBeVisible()
    const firstPaper = page.getByTestId('paper-card').first()
    await expect(firstPaper).toBeVisible()

    await firstPaper.getByTestId('paper-card-start').click()
    await expect(page.getByTestId('paper-intro')).toBeVisible()
    await page.getByTestId('paper-intro-start-button').click()

    await expect(page.getByTestId('paper-practice-page')).toBeVisible()
    await expect(page.getByTestId('paper-question-content')).toBeVisible()
    await page.getByRole('button', { name: '交卷检查' }).click()
    await expect(page.getByTestId('paper-submit')).toBeVisible()
    await page.getByRole('button', { name: '确认交卷' }).click()

    await page.waitForURL(/\/practice\/summary(?:$|[?#])/, { timeout: 15_000 })
    await expect(page.getByText('总结')).toBeVisible()
  })

  test('knowledge tree open -> edit -> save works', async ({ page }) => {
    await prepareSmokeWorkspace(true)
    const adminId = await getAdminId()
    const noteTitle = `SMOKE 知识点 ${Date.now()}`
    const note = await prisma.userNote.create({
      data: {
        userId: adminId,
        type: '常识判断',
        subtype: '错题复盘',
        module2: '政治',
        module3: '党史理论',
        title: noteTitle,
        content: '初始正文',
        sourceErrorIds: '',
        isPrivate: false,
      },
    })

    try {
      await authenticateAdmin(page)
      await page.goto('/dashboard')
      await page.goto('/notes')
      await expect(page.getByTestId('knowledge-tree-page')).toBeVisible()

      await page.getByRole('button', { name: '政治' }).click()
      await page.getByRole('button', { name: '党史理论' }).click()

      const card = page.getByTestId('knowledge-note-card').filter({ hasText: noteTitle })
      await expect(card).toBeVisible()
      await card.getByTestId('knowledge-note-inline-edit').click()

      const editor = card.getByTestId('markdown-editor-textarea')
      await expect(editor).toBeVisible()
      await editor.fill('更新后的正文\n\n- smoke 通过')
      await card.getByTestId('knowledge-note-inline-save').click()

      await expect(card).toContainText('更新后的正文')
    } finally {
      await prisma.userNote.deleteMany({ where: { id: note.id } })
    }
  })

  test('regular practice minimal chain works', async ({ page }) => {
    await prepareSmokeWorkspace(true)
    const adminId = await getAdminId()
    await prisma.user.update({
      where: { id: adminId },
      data: { dailyGoal: 1 },
    })
    await seedSinglePracticeQuestion(adminId)

    await authenticateAdmin(page)
    await page.goto('/dashboard')
    await page.goto('/practice')
    await expect(page.getByText('选择练习模式')).toBeVisible()
    await page.getByRole('button', { name: '快速复习模式' }).click()

    await expect(page.getByTestId('paper-practice-page')).toBeVisible()
    await expect(page.getByTestId('paper-question-content')).toBeVisible()
    const firstOption = page.getByTestId('paper-option').first()
    await expect(firstOption).toBeVisible()
    await firstOption.click()

    await expect(page.getByRole('button', { name: '查看今日总结 →' })).toBeVisible()
    await page.getByRole('button', { name: '查看今日总结 →' }).click()

    await page.waitForURL(/\/practice\/summary(?:$|[?#])/, { timeout: 15_000 })
    await expect(page.getByText('总结')).toBeVisible()
  })
})
