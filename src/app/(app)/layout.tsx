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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      onboardingCompletedAt: true,
      examType: true,
      targetScore: true,
      dailyGoal: true,
    },
  })

  // Once a user has any exam config footprint, mark onboarding as completed to avoid repeated prompts.
  let onboardingCompletedAt = user?.onboardingCompletedAt ?? null
  const hasExamConfigFootprint = Boolean(user?.examType) && typeof user?.targetScore === 'number' && typeof user?.dailyGoal === 'number'
  if (!onboardingCompletedAt && hasExamConfigFootprint) {
    const now = new Date()
    await prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: now },
    }).then(() => {
      onboardingCompletedAt = now
    }).catch(() => {})
  }

  const isConfigured = Boolean(onboardingCompletedAt)
  const pathname = headers().get('x-next-url') ?? ''
  const shouldRedirectOnboarding =
    !isConfigured &&
    !pathname.includes('/onboarding') &&
    !pathname.includes('/settings')

  if (shouldRedirectOnboarding) redirect('/onboarding')

  return (
    <div className="app-shell min-h-screen bg-slate-50 lg:flex">
      <Navbar />
      <main className="app-content min-w-0 flex-1 pb-20 lg:pb-0">
        {children}
      </main>
    </div>
  )
}
