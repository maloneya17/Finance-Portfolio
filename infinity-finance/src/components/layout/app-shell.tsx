'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import type { Profile, Settings } from '@/types/supabase'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, ArrowLeftRight, Receipt, TrendingUp,
  BarChart3, Lightbulb, Settings2, Menu, X, Crown,
} from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/bills',        label: 'Bills',        icon: Receipt },
  { href: '/wealth',       label: 'Wealth',       icon: TrendingUp },
  { href: '/reports',      label: 'Reports',      icon: BarChart3 },
  { href: '/insights',     label: 'Insights',     icon: Lightbulb },
  { href: '/settings',     label: 'Settings',     icon: Settings2 },
]

interface AppShellProps {
  user: User
  profile: Profile | null
  settings: Settings | null
  children: React.ReactNode
}

export function AppShell({ user, profile, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const isPro = profile?.subscription === 'pro'

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 overflow-hidden">
      <a href="#main-content" className="skip-nav">Skip to main content</a>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <nav
        role="navigation"
        aria-label="Main navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex flex-col w-64 bg-slate-900 transition-transform duration-300 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--ios-blue)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
          </div>
          <div>
            <div className="font-bold text-white text-sm leading-none">Infinity</div>
            <div className="text-xs text-slate-400 leading-none mt-0.5">Finance</div>
          </div>
          <button
            className="ml-auto lg:hidden text-slate-400 hover:text-white p-1 rounded-lg"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Nav items */}
        <div className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[rgba(0,122,255,0.2)] text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                {item.label}
                {item.href === '/insights' && !isPro && (
                  <Crown className="w-3 h-3 ml-auto" style={{ color: 'var(--ios-orange)' }} aria-label="Pro feature" />
                )}
              </Link>
            )
          })}
        </div>

        {/* User / upgrade section */}
        <div className="p-3 border-t border-slate-800">
          {!isPro && (
            <Link
              href="/settings?tab=billing"
              className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl mb-2 text-xs font-semibold transition"
              style={{ background: 'rgba(0,122,255,0.15)', color: 'var(--ios-teal)' }}
            >
              <Crown className="w-3.5 h-3.5" aria-hidden="true" style={{ color: 'var(--ios-orange)' }} />
              Upgrade to Pro
            </Link>
          )}
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {(profile?.username ?? user.email ?? '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white truncate">{profile?.username ?? 'My Account'}</div>
              <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
            </div>
            {isPro && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: 'var(--ios-blue)' }}>
                PRO
              </span>
            )}
          </div>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--ios-blue)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
              </svg>
            </div>
            <span className="font-bold text-slate-900 dark:text-white text-sm">Infinity Finance</span>
          </div>
        </header>

        {/* Page content */}
        <main
          id="main-content"
          className="flex-1 overflow-y-auto"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
