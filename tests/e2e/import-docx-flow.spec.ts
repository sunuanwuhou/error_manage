import { expect, test } from '@playwright/test'
import fs from 'node:fs'

import {
  cleanupImportedSession,
  createPrismaClient,
  prepareAdminBaseline,
  resolveExistingFixturePath,
  signInAndNormalize,
} from './helpers'

const prisma = createPrismaClient()
const DOCX_FIXTURE = resolveExistingFixturePath([
  process.env.E2E_IMPORT_DOCX_FIXTURE ?? '',
  'C:\\Users\\USER\\Desktop\\错题系统\\word版本\\广东省考\\2025年广东省公务员录用考试《行测》题（网友回忆版）.docx',
  'C:\\Users\\USER\\Desktop\\错题系统\\word版本\\广东省考\\2024年广东省公务员录用考试《行测》题（网友回忆版）.docx',
].filter(Boolean))

test.describe('docx import flow', () => {
  test.beforeEach(async () => {
    await prepareAdminBaseline(prisma)
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test('supports docx parse and confirm import', async ({ page }) => {
    if (!DOCX_FIXTURE) {
      test.skip(true, 'Missing docx fixture for e2e')
    }

    const uniqueSession = `DOCX E2E ${Date.now()}`

    try {
      await signInAndNormalize(page)
      await page.goto('/import')
      await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', '.docx')

      const uploadResponsePromise = page.waitForResponse(res => res.url().includes('/api/import/upload') && res.request().method() === 'POST')
      await page.locator('input[type="file"]').setInputFiles(DOCX_FIXTURE!)
      const uploadResponse = await uploadResponsePromise
      expect(uploadResponse.ok()).toBeTruthy()

      const uploadData = await uploadResponse.json()
      expect(uploadData.total).toBeGreaterThan(0)
      expect(uploadData.payload).toBeTruthy()

      const confirmResponse = await page.request.post('/api/import/confirm', {
        data: {
          payload: uploadData.payload,
          srcYear: uploadData.inferredMeta?.srcYear ?? '2025',
          srcProvince: uploadData.inferredMeta?.srcProvince ?? undefined,
          srcSession: uniqueSession,
          duplicateMode: 'skip',
          selected: Array.from({ length: uploadData.total }, (_, i) => i),
        },
      })

      expect(confirmResponse.ok()).toBeTruthy()
      const confirmData = await confirmResponse.json()
      expect(confirmData.imported + confirmData.overwritten).toBeGreaterThan(0)

      const importedCount = await prisma.question.count({
        where: { srcExamSession: uniqueSession },
      })
      expect(importedCount).toBeGreaterThan(0)
    } finally {
      await cleanupImportedSession(prisma, uniqueSession)
    }
  })
})
