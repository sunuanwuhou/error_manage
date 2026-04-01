import { prisma } from '@/lib/prisma'

export async function createImportJob(input: {
  userId: string
  filename: string
  parsedQuestions: string
  status?: string
  failReason?: string | null
}) {
  return prisma.importJob.create({
    data: {
      userId: input.userId,
      filename: input.filename,
      parsedQuestions: input.parsedQuestions,
      status: input.status || 'parsed',
      failReason: input.failReason || null,
    },
  })
}

export async function updateImportJobResult(input: {
  importJobId: string
  importedCount: number
  status: string
  failReason?: string | null
}) {
  return prisma.importJob.update({
    where: { id: input.importJobId },
    data: {
      importedCount: input.importedCount,
      status: input.status,
      failReason: input.failReason || null,
    },
  })
}
