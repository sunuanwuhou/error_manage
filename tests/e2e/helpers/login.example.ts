import { Page } from '@playwright/test'
import { smokeConfig } from './smoke-config.example'

export async function loginByUi(page: Page) {
  await page.goto(`${smokeConfig.baseUrl}/login`)
  await page.getByLabel(/email|邮箱/i).fill(smokeConfig.email)
  await page.getByLabel(/password|密码/i).fill(smokeConfig.password)
  await page.getByRole('button', { name: /登录|sign in/i }).click()
}
