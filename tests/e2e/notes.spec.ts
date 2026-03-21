import { expect, test } from '@playwright/test'
import { createPrismaClient, prepareAdminBaseline, signInAndNormalize } from './helpers'

const prisma = createPrismaClient()

test.describe('notes + insights api regression', () => {
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

  test('note create/update/delete works', async ({ page }) => {
    const title = `E2E Note ${Date.now()}`
    const updatedTitle = `${title} Updated`
    const content = 'first body'
    const updatedContent = 'updated body'

    await signInAndNormalize(page)

    const createRes = await page.request.post('/api/notes', {
      data: {
        type: '判断推理',
        subtype: '通用',
        module2: '图形推理',
        module3: '样例模块',
        title,
        content,
        sourceErrorIds: '',
        isPrivate: false,
      },
    })
    expect(createRes.ok()).toBeTruthy()
    const created = await createRes.json()
    expect(created.title).toBe(title)
    expect(created.content).toBe(content)

    const patchRes = await page.request.patch('/api/notes', {
      data: {
        id: created.id,
        title: updatedTitle,
        content: updatedContent,
        subtype: '通用',
        module2: '图形推理',
        module3: '样例模块',
        sourceErrorIds: '',
        isPrivate: false,
      },
    })
    expect(patchRes.ok()).toBeTruthy()

    const listRes = await page.request.get('/api/notes')
    expect(listRes.ok()).toBeTruthy()
    const list = await listRes.json()
    const updated = list.find((item: { id: string }) => item.id === created.id)
    expect(updated?.title).toBe(updatedTitle)
    expect(updated?.content).toBe(updatedContent)

    const deleteRes = await page.request.delete(`/api/notes?id=${encodeURIComponent(created.id)}`)
    expect(deleteRes.ok()).toBeTruthy()
  })

  test('note dedupe works for same knowledge point', async ({ page }) => {
    const title = `E2E Draft ${Date.now()}`
    const content = 'same knowledge point content'

    await signInAndNormalize(page)

    const first = await page.request.post('/api/notes', {
      data: {
        type: '判断推理',
        subtype: '错题复盘',
        module2: '',
        module3: '',
        title,
        content,
        sourceErrorIds: '',
        isPrivate: false,
      },
    })
    expect(first.ok()).toBeTruthy()

    const second = await page.request.post('/api/notes', {
      data: {
        type: '判断推理',
        subtype: '错题复盘',
        module2: '',
        module3: '',
        title,
        content,
        sourceErrorIds: '',
        isPrivate: false,
      },
    })
    expect(second.ok()).toBeTruthy()
    const secondData = await second.json()
    expect(secondData.deduped).toBe(true)

    const count = await prisma.userNote.count({ where: { title } })
    expect(count).toBe(1)
  })

  test('insight create/update/delete and dedupe works', async ({ page }) => {
    const skillTag = `E2E Insight ${Date.now()}`
    const finalContent = 'first insight'
    const updatedContent = 'updated insight'

    await signInAndNormalize(page)

    const createRes = await page.request.post('/api/insights', {
      data: {
        skillTag,
        insightType: 'rule',
        aiDraft: '',
        finalContent,
        sourceErrorIds: '',
        domainExamples: '',
      },
    })
    expect(createRes.ok()).toBeTruthy()
    const created = await createRes.json()
    expect(created.skillTag).toBe(skillTag)

    const patchRes = await page.request.patch('/api/insights', {
      data: {
        id: created.id,
        skillTag,
        insightType: 'rule',
        aiDraft: '',
        finalContent: updatedContent,
        sourceErrorIds: '',
        domainExamples: '',
        isActive: true,
      },
    })
    expect(patchRes.ok()).toBeTruthy()

    const dedupeRes = await page.request.post('/api/insights', {
      data: {
        skillTag,
        insightType: 'rule',
        aiDraft: '',
        finalContent: updatedContent,
        sourceErrorIds: '',
        domainExamples: '',
      },
    })
    expect(dedupeRes.ok()).toBeTruthy()
    const dedupeData = await dedupeRes.json()
    expect(dedupeData.deduped).toBe(true)

    const count = await prisma.userInsight.count({ where: { skillTag } })
    expect(count).toBe(1)

    const deleteRes = await page.request.delete(`/api/insights?id=${encodeURIComponent(created.id)}`)
    expect(deleteRes.ok()).toBeTruthy()
  })
})
