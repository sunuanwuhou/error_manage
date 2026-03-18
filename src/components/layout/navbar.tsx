'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

const tabs = [
  { href: '/dashboard', label: '今日',  icon: '📋' },
  { href: '/practice',  label: '练习',  icon: '✏️' },
  { href: '/errors',    label: '错题本', icon: '📕' },
  { href: '/notes',     label: '笔记',  icon: '📝' },
  { href: '/knowledge',  label: '知识库', icon: '🧪' },
  { href: '/stats',     label: '进度',  icon: '📊' },
]

export function Navbar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const isAdmin = (session?.user as any)?.role === 'admin'

  const allTabs = isAdmin
    ? [...tabs, { href: '/admin/users', label: '管理', icon: '👤' }]
    : tabs

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 pb-safe z-50">
      <div className="flex max-w-lg mx-auto">
        {allTabs.map(tab => {
          const active = pathname.startsWith(tab.href)
          return (
            <Link key={tab.href} href={tab.href}
              className={`flex-1 flex flex-col items-center py-2 text-xs gap-0.5 min-h-[44px] justify-center transition-colors
                ${active ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className="font-medium">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
