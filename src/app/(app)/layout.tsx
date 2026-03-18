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
    select: { examDate: true },
  })

  // 未完成 onboarding 向导时重定向（排除向导页本身）
  const headerList = headers()
  const pathname   = headerList.get('x-next-url') ?? ''
  const isOnboarding = !user?.examDate && !pathname.includes('/onboarding')
  if (isOnboarding) redirect('/onboarding')

  return (
    <div className="min-h-screen pb-20">
      {children}
      <Navbar />
    </div>
  )
}
