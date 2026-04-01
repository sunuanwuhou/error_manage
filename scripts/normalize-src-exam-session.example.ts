/**
 * 这是历史 srcExamSession 规范化脚本模板。
 *
 * 目标：
 * - 把“上午 / 下午 / A卷 / B卷 / 第一场 / 第二场”等历史值统一口径
 * - 仅作为模板示例，执行前请先在本地数据库备份
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function normalizeSession(input: string | null | undefined) {
  const value = String(input || '').trim()
  if (!value) return null
  if (/上午|am|morning/i.test(value)) return '上午'
  if (/下午|pm|afternoon/i.test(value)) return '下午'
  if (/第一场|一场/.test(value)) return '第一场'
  if (/第二场|二场/.test(value)) return '第二场'
  return value
}

async function main() {
  const rows = await prisma.question.findMany({
    where: {
      NOT: { srcExamSession: null },
    },
    select: { id: true, srcExamSession: true },
    take: 10000,
  })

  for (const row of rows) {
    const normalized = normalizeSession(row.srcExamSession)
    if (normalized !== row.srcExamSession) {
      await prisma.question.update({
        where: { id: row.id },
        data: { srcExamSession: normalized },
      })
      console.log(`updated ${row.id}: ${row.srcExamSession} -> ${normalized}`)
    }
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
