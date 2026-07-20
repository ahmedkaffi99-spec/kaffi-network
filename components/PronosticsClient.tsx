'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/Header'
import { SessionCard } from '@/components/SessionCard'
import type { PronosticSession, SessionStatus } from '@/lib/types'

type FilterValue = SessionStatus | 'all'

const FILTERS: { label: string; value: FilterValue }[] = [
  { label: 'Toutes', value: 'all' },
  { label: 'Brouillons', value: 'draft' },
  { label: 'Approuvées', value: 'approved' },
  { label: 'Publiées', value: 'published' },
  { label: 'Rejetées', value: 'rejected' },
]

interface Props {
  sessions: PronosticSession[]
}

export function PronosticsClient({ sessions }: Props) {
  const [filter, setFilter] = useState<FilterValue>('all')
  const router = useRouter()

  const filtered = filter === 'all' ? sessions : sessions.filter(s => s.status === filter)

  const counts: Record<FilterValue, number> = {
    all: sessions.length,
    draft: sessions.filter(s => s.status === 'draft').length,
    approved: sessions.filter(s => s.status === 'approved').length,
    published: sessions.filter(s => s.status === 'published').length,
    rejected: sessions.filter(s => s.status === 'rejected').length,
  }

  async function handleApprove(id: string) {
    const res = await fetch(`/api/sessions/${id}/approve`, { method: 'POST' })
    if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
    router.refresh()
  }

  async function handlePublish(id: string, file: File) {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`/api/publish/${id}`, { method: 'POST', body: formData })
    if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
    router.refresh()
  }

  return (
    <div>
      <Header title="Pronostics" subtitle="Combinés générés par l'IA — validation et publication" />

      <div className="p-8">
        <div className="flex items-center gap-1 mb-6 p-1 bg-navy-800/50 border border-navy-700/50 rounded-xl w-fit flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                filter === f.value ? 'bg-navy-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f.label}
              <span className={`text-xs rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center ${
                filter === f.value ? 'bg-gold-500/20 text-gold-400' : 'bg-navy-700/60 text-gray-600'
              }`}>
                {counts[f.value]}
              </span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-600">
            <span className="text-5xl mb-4">📭</span>
            <p className="text-base">Aucune session dans cette catégorie</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(session => (
              <SessionCard key={session.id} session={session} onApprove={handleApprove} onPublish={handlePublish} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
