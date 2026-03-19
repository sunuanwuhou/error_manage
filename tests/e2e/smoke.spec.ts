import { expect, test } from '@playwright/test'

test.describe('app smoke', () => {
  test('root redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: '错题管理系统' })).toBeVisible()
  })

  test('login page renders the credential form', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: '错题管理系统' })).toBeVisible()
    await expect(page.getByText('公务员行测备考')).toBeVisible()
    await expect(page.getByPlaceholder('输入用户名')).toBeVisible()
    await expect(page.getByPlaceholder('输入密码')).toBeVisible()
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  })
})
