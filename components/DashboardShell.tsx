'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'

interface Props {
  userEmail: string | null
  children: React.ReactNode
}

// Sidebar toujours visible en desktop (lg+), tiroir coulissant sur mobile —
// utile ici car l'upload de la capture 1xBet se fait souvent depuis le
// téléphone (voir app/api/publish/[sessionId]/route.ts).
export function DashboardShell({ userEmail, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <div className="flex min-h-screen">
      {/* Barre mobile — masquée en desktop */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 flex items-center gap-3 px-4 h-14 bg-navy-900/95 backdrop-blur-sm border-b border-navy-700/50">
        <button
          onClick={() => setMobileOpen(true)}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-300 hover:text-white hover:bg-navy-800 transition"
          aria-label="Ouvrir le menu"
        >
          <span className="text-lg">☰</span>
        </button>
        <div className="font-bold text-sm">
          <span className="text-gold-400">IA</span>
          <span className="text-white ml-1.5">PRONOSTICS</span>
        </div>
      </div>

      {/* Overlay mobile */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar userEmail={userEmail} open={mobileOpen} onClose={() => setMobileOpen(false)} />

      <main className="flex-1 overflow-auto min-w-0 pt-14 lg:pt-0">{children}</main>
    </div>
  )
}
