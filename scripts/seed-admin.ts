// scripts/seed-admin.ts
// ============================================================
// 创建第一个管理员账号（只需运行一次）
// 运行：npx tsx scripts/seed-admin.ts
// ============================================================

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { addDays } from 'date-fns'

const prisma = new PrismaClient()

async function main() {
  const username = process.env.ADMIN_USERNAME ?? 'admin'
  const password = process.env.ADMIN_PASSWORD ?? 'changeme123'

  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) {
    console.log(`用户 "${username}" 已存在，跳过创建`)
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: 'admin',
      passwordExpireAt: addDays(new Date(), 365),  // 1年有效期
      examType: 'guo_kao',
      targetScore: 85,
      dailyGoal: 70,
    },
  })

  console.log(`✅ 管理员账号创建成功`)
  console.log(`   用户名：${username}`)
  console.log(`   密码：${password}`)
  console.log(`   ID：${user.id}`)
  console.log(`\n⚠️  请立即修改默认密码！`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
