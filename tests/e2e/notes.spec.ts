import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createPrismaClient, prepareAdminBaseline, signInAndNormalize } from './helpers'

const prisma = createPrismaClient()

function noteCard(page: Page, title: string) {
  return page
    .getByText(title, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"shadow-sm") and contains(@class,"rounded-2xl")][1]')
}

test.describe('notes CRUD regression', () => {
  test.beforeEach(async () => {
    await prepareAdminBaseline(prisma)
  })

  test.afterEach(async () => {
    await prisma.userNote.deleteMany({ where: { title: { startsWith: 'E2E Note' } } })
    await prisma.userNote.deleteMany({ where: { title: { startsWith: 'E2E Draft' } } })
    await prisma.userInsight.deleteMany({ where: { skillTag: { startsWith: 'E2E Insight' } } })
    await prepareAdminBaseline(prisma)
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test('can create, edit, and delete a note', async ({ page }) => {
    const runId = Date.now()
    const title = `E2E Note ${runId}`
    const updatedTitle = `${title} Updated`
    const content = `${title} content`
    const updatedContent = `${content} rewritten`

    await signInAndNormalize(page)
    await page.goto('/notes')
    await expect(page.getByRole('heading', { name: '笔记 & 规律' })).toBeVisible()

    await page.getByRole('button', { name: '+ 新增' }).click()
    await page.locator('label:has-text("标题") + input').fill(title)
    await page.locator('label:has-text("内容（支持 Markdown）") + textarea').fill(content)
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByText(title, { exact: true })).toBeVisible()

    const createdCard = noteCard(page, title)
    await createdCard.getByRole('button', { name: '编辑' }).click()
    await page.locator('label:has-text("标题") + input').fill(updatedTitle)
    await page.locator('label:has-text("内容（支持 Markdown）") + textarea').fill(updatedContent)
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByText(updatedTitle, { exact: true })).toBeVisible()
    await expect(page.getByText(title, { exact: true })).toHaveCount(0)

    const updatedCard = noteCard(page, updatedTitle)
    await page.once('dialog', dialog => dialog.accept())
    await updatedCard.getByRole('button', { name: '删除' }).click()
    await expect(page.getByText(updatedTitle, { exact: true })).toHaveCount(0)
  })

  test('can create, edit, and delete an insight', async ({ page }) => {
    const runId = Date.now()
    const skillTag = `E2E Insight ${runId}`
    const insightText = `${skillTag} final content`
    const updatedInsightText = `${insightText} updated`

    await signInAndNormalize(page)
    await page.goto('/notes')
    await page.getByRole('button', { name: '规律' }).click()
    await expect(page.getByRole('heading', { name: '笔记 & 规律' })).toBeVisible()

    await page.getByRole('button', { name: '+ 新增' }).click()
    await page.locator('label:has-text("考点") + input').fill(skillTag)
    await page.locator('label:has-text("规律内容（人工确认版）") + textarea').fill(insightText)
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByText(skillTag, { exact: true })).toBeVisible()

    const createdCard = noteCard(page, insightText)
    await createdCard.getByRole('button', { name: '编辑' }).click()
    await page.locator('label:has-text("考点") + input').fill(skillTag)
    await page.locator('label:has-text("规律内容（人工确认版）") + textarea').fill(updatedInsightText)
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByText(updatedInsightText, { exact: true })).toBeVisible()
    await expect(page.getByText(insightText, { exact: true })).toHaveCount(0)

    const updatedCard = noteCard(page, updatedInsightText)
    await page.once('dialog', dialog => dialog.accept())
    await updatedCard.getByRole('button', { name: '删除' }).click()
    await expect(page.getByText(updatedInsightText, { exact: true })).toHaveCount(0)
  })

  test('can open a prefilled note draft from query params', async ({ page }) => {
    const title = `E2E Draft ${Date.now()}`
    const content = '从套卷总结自动沉淀的复盘内容'

    await signInAndNormalize(page)
    await page.goto(`/notes?draft=1&draftKind=notes&draftType=${encodeURIComponent('判断推理')}&draftSubtype=${encodeURIComponent('套卷总结')}&draftTitle=${encodeURIComponent(title)}&draftContent=${encodeURIComponent(content)}`)

    await expect(page.locator('label:has-text("标题") + input')).toHaveValue(title)
    await expect(page.locator('label:has-text("内容（支持 Markdown）") + textarea')).toHaveValue(content)
    await expect(page.locator('label:has-text("来源") + select')).toHaveValue('套卷总结')

    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText(title, { exact: true })).toBeVisible()
  })

  test('does not create duplicate notes from the same prefilled draft', async ({ page }) => {
    const title = `E2E Draft ${Date.now()}`
    const content = '重复点击沉淀按钮时，不应生成第二条相同笔记'
    const draftUrl = `/notes?draft=1&draftKind=notes&draftType=${encodeURIComponent('判断推理')}&draftSubtype=${encodeURIComponent('错题复盘')}&draftTitle=${encodeURIComponent(title)}&draftContent=${encodeURIComponent(content)}`

    await signInAndNormalize(page)
    await page.goto(draftUrl)
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText(title, { exact: true })).toBeVisible()

    await page.goto(draftUrl)
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('已存在同知识点笔记，未重复创建')).toBeVisible()

    const count = await prisma.userNote.count({ where: { title } })
    expect(count).toBe(1)
  })

  test('does not create a second note for the same knowledge point title', async ({ page }) => {
    const title = `E2E Note ${Date.now()}`

    await signInAndNormalize(page)
    await page.goto('/notes')

    await page.getByRole('button', { name: '+ 新增' }).click()
    await page.locator('label:has-text("标题") + input').fill(title)
    await page.locator('label:has-text("内容（支持 Markdown）") + textarea').fill('第一次记录这个知识点')
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText(title, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '+ 新增' }).click()
    await page.locator('label:has-text("标题") + input').fill(title)
    await page.locator('label:has-text("内容（支持 Markdown）") + textarea').fill('同知识点的第二次描述，不应生成重复记录')
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByText('已存在同知识点笔记，未重复创建')).toBeVisible()
    const count = await prisma.userNote.count({ where: { title } })
    expect(count).toBe(1)
  })

  test('does not create a second insight for the same knowledge point', async ({ page }) => {
    const skillTag = `E2E Insight ${Date.now()}`

    await signInAndNormalize(page)
    await page.goto('/notes')
    await page.getByRole('button', { name: '规律' }).click()

    await page.getByRole('button', { name: '+ 新增' }).click()
    await page.locator('label:has-text("考点") + input').fill(skillTag)
    await page.locator('label:has-text("规律内容（人工确认版）") + textarea').fill('第一次规律记录')
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText(skillTag, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '+ 新增' }).click()
    await page.locator('label:has-text("考点") + input').fill(skillTag)
    await page.locator('label:has-text("规律内容（人工确认版）") + textarea').fill('同知识点的第二种表述，不应重复新增')
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByText('已存在同知识点规律，未重复创建')).toBeVisible()
    const count = await prisma.userInsight.count({ where: { skillTag } })
    expect(count).toBe(1)
  })
})
