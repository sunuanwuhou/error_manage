'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

const tabs = [
  { href: '/dashboard', label: '今日',  icon: '📋' },
  { href: '/practice',  label: '练习',  icon: '✏️' },
  { href: '/papers',    label: '套卷',  icon: '📚' },
  { href: '/errors',    label: '错题本', icon: '📕' },
  { href: '/notes',     label: '笔记',  icon: '📝' },
  { href: '/stats',     label: '进度',  icon: '📊' },
  { href: '/settings',  label: '设置',  icon: '⚙️' },
]

export function Navbar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const isAdmin = (session?.user as any)?.role === 'admin'

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-100 bg-white pb-safe lg:hidden">
        <div className="flex max-w-lg mx-auto">
          {tabs.map(tab => {
            const active = pathname.startsWith(tab.href)
            return (
              <Link key={tab.href} href={tab.href}
                className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors
                  ${active ? 'text-blue-600' : 'text-gray-400'}`}>
                <span className="text-xl leading-none">{tab.icon}</span>
                <span className="font-medium">{tab.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      <aside className="hidden lg:flex lg:w-72 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white/90 lg:px-5 lg:py-6 lg:backdrop-blur">
        <div className="sticky top-0">
          <div className="rounded-3xl bg-slate-900 px-5 py-5 text-white shadow-sm">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-300">Error Manage</p>
            <h2 className="mt-3 text-2xl font-semibold">备考驾驶舱</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              PC 端聚合信息，手机端保持轻量操作。
            </p>
          </div>

          <div className="mt-5 space-y-1.5">
            {tabs.map(tab => {
              const active = pathname.startsWith(tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-colors ${
                    active
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="text-lg leading-none">{tab.icon}</span>
                  <span className="font-medium">{tab.label}</span>
                </Link>
              )
            })}
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <p className="font-medium text-slate-800">当前模式</p>
            <p className="mt-2 leading-6">
              手机适合刷题和快速录题，PC 更适合看进度、笔记和整体训练节奏。
            </p>
            {isAdmin && (
              <p className="mt-3 text-xs font-medium text-blue-600">管理员账号已登录</p>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
