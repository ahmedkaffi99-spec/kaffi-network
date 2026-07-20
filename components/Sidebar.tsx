'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/dashboard', label: "Vue d'ensemble", icon: '📊', exact: true },
  { href: '/dashboard/pronostics', label: 'Pronostics', icon: '⚽', exact: false },
  { href: '/dashboard/stats', label: 'Statistiques', icon: '📈', exact: false },
]

interface SidebarProps {
  userEmail: string | null
  open: boolean
  onClose: () => void
}

export function Sidebar({ userEmail, open, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initial = userEmail?.trim()?.[0]?.toUpperCase() ?? '?'

  return (
    <aside
      className={`w-64 bg-navy-900 border-r border-navy-700/50 flex flex-col min-h-screen flex-shrink-0
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-200
        lg:static lg:translate-x-0
        ${open ? 'translate-x-0' : '-translate-x-full'}`}
    >
      {/* Logo */}
      <div className="p-5 border-b border-navy-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold-500/15 border border-gold-500/30 flex items-center justify-center">
            <span className="text-lg">⚡</span>
          </div>
          <div>
            <div className="font-bold text-sm leading-tight">
              <span className="text-gold-400">IA</span>
              <span className="text-white ml-1.5">PRONOSTICS</span>
            </div>
            <div className="text-xs text-gray-600 mt-0.5">& Coupons · Dashboard</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-navy-800 transition"
          aria-label="Fermer le menu"
        >
          ✕
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5">
        <div className="px-2 py-2 mb-1">
          <span className="text-xs text-gray-600 uppercase tracking-wider font-medium">Menu</span>
        </div>
        {navItems.map(item => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                isActive
                  ? 'bg-gold-500/12 text-gold-400 border border-gold-500/20'
                  : 'text-gray-400 hover:text-white hover:bg-navy-800'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-gold-500" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Telegram link */}
      <div className="px-3 pb-3">
        <div className="bg-navy-800/60 border border-navy-700/50 rounded-xl p-3 flex items-center gap-2.5">
          <span className="text-xl">✈️</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-300">Canal Telegram</div>
            <div className="text-xs text-gray-600 truncate">@IAdePronosticsCoupons</div>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" title="En ligne" />
        </div>
      </div>

      {/* User + Logout */}
      <div className="p-3 border-t border-navy-700/50">
        <div className="flex items-center gap-3 px-2 py-2 mb-1">
          <div className="w-8 h-8 rounded-full bg-gold-500/20 border border-gold-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-gold-400">{initial}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{userEmail ?? 'Compte'}</div>
            <div className="text-xs text-gray-600 truncate">IA de Pronostics & Coupons</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-red-400 hover:bg-red-900/15 rounded-xl transition duration-200"
        >
          <span>→</span>
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  )
}
