// src/app/(app)/layout.tsx — 登录后页面共享布局
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Navbar } from '@/components/layout/navbar'
import { headers } from 'next/headers'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const userId = (session.user as any).id
  const user   = await prisma.user.findUnique({
    where:  { id: userId },
    select: {
      onboardingCompletedAt: true,
      examType: true,
      examDate: true,
      targetScore: true,
      dailyGoal: true,
      targetProvince: true,
    },
  })

  const legacyConfigured = Boolean(
    user?.examDate ||
    user?.targetProvince ||
    user?.targetScore !== 85 ||
    user?.dailyGoal !== 70 ||
    user?.examType !== 'guo_kao'
  )

  let onboardingCompletedAt = user?.onboardingCompletedAt ?? null
  if (user && legacyConfigured && !onboardingCompletedAt) {
    const now = new Date()
    await prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: now },
    }).then(() => {
      onboardingCompletedAt = now
    }).catch(() => {})
  }

  const isConfigured = Boolean(onboardingCompletedAt)

  // 未完成 onboarding 时重定向；settings 保留为唯一的完整配置入口
  const headerList = headers()
  const pathname   = headerList.get('x-next-url') ?? ''
  const isOnboarding = !isConfigured &&
    !pathname.includes('/onboarding') &&
    !pathname.includes('/settings')
  if (isOnboarding) redirect('/onboarding')

  return (
    <div className="min-h-screen pb-20">
      {children}
      <Navbar />
    </div>
  )
}
