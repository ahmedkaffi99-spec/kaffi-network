'use client'

import { useState } from 'react'
import { Header } from '@/components/Header'
import { SessionChat } from '@/components/SessionChat'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/utils'
import type { Tier } from '@/lib/types'

export interface ChatSessionSummary {
  id: string
  date: string
  tier: Tier
  status: string
  combined_odds: number | null
  picks: { home_team: string; away_team: string; was_rejected: boolean }[]
}

interface Props {
  sessions: ChatSessionSummary[]
}

const TIER_LABELS: Record<string, string> = {
  prudent: 'Prudent',
  equilibre: 'Équilibré',
  audacieux: 'Audacieux',
}

// Point d'entrée unique pour discuter avec l'Analyste/le Rédacteur de
// n'importe quel combiné, sans avoir à aller chercher le chat dans chaque
// page de détail de session (voir components/SessionChat.tsx).
export function ChatHubClient({ sessions }: Props) {
  // Pas de sélection par défaut — sur mobile la liste et le chat partagent
  // le même espace (l'un ou l'autre, jamais les deux) ; présélectionner la
  // première session ferait sauter directement dans un chat au lieu de la
  // liste au premier chargement.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = sessions.find(s => s.id === selectedId) ?? null

  return (
    <div>
      <Header title="Chat" subtitle="Discute avec l'Analyste ou le Rédacteur de n'importe quel combiné" />

      <div className="p-4 sm:p-8">
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          {/* Liste des sessions */}
          <div className={`w-full lg:w-72 flex-shrink-0 bg-navy-800/60 border border-navy-700/50 rounded-2xl overflow-hidden ${selected ? 'hidden lg:block' : 'block'}`}>
            <div className="px-4 py-3 border-b border-navy-700/50">
              <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Sessions récentes</span>
            </div>
            <div className="max-h-[32rem] overflow-y-auto p-2 space-y-1">
              {sessions.length === 0 ? (
                <p className="text-sm text-gray-600 p-3">Aucune session pour l&apos;instant.</p>
              ) : (
                sessions.map(s => {
                  const picks = s.picks.filter(p => !p.was_rejected)
                  const label = picks.length ? `${picks[0].home_team} vs ${picks[0].away_team}${picks.length > 1 ? ` +${picks.length - 1}` : ''}` : 'Aucun pick'
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl transition ${
                        selectedId === s.id ? 'bg-gold-500/12 border border-gold-500/25' : 'hover:bg-navy-700/40 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs text-gray-500">
                          {new Date(s.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} · {TIER_LABELS[s.tier] ?? s.tier}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[s.status] ?? 'bg-navy-700 text-gray-300'}`}>
                          {STATUS_LABELS[s.status] ?? s.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-300 truncate">{label}</div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Chat */}
          <div className={`flex-1 min-w-0 w-full ${selected ? 'block' : 'hidden lg:block'}`}>
            {selected ? (
              <div>
                <button onClick={() => setSelectedId(null)} className="lg:hidden mb-3 text-sm text-gray-400 hover:text-white transition">
                  ← Retour à la liste
                </button>
                <SessionChat sessionId={selected.id} editable={selected.status === 'draft'} />
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-600 text-sm bg-navy-800/40 border border-dashed border-navy-600/50 rounded-2xl">
                Choisis une session à gauche pour démarrer une discussion.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
