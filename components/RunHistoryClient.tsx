'use client'

import { useState } from 'react'
import { Header } from '@/components/Header'
import { LiveAgentJournal } from '@/components/LiveAgentJournal'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/utils'

export interface RunSummary {
  runId: string
  startedAt: string
  endedAt: string
  messageCount: number
  sessions: { tier: string; status: string; date: string; combined_odds: number | null }[]
}

interface Props {
  runs: RunSummary[]
}

const TIER_LABELS: Record<string, string> = {
  prudent: 'Prudent',
  equilibre: 'Équilibré',
  audacieux: 'Audacieux',
}

function formatDuration(startedAt: string, endedAt: string): string {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`
}

// Historique technique des runs du pipeline (un run = un appel /api/generate
// ou /api/cron/generate) — distinct des Statistiques (résultats des paris) et
// de Pronostics (les combinés eux-mêmes). Ici : quand le pipeline a tourné,
// combien de temps, combien de paliers produits, avec accès au journal
// complet de chaque run (même composant que la vue live, en mode statique).
export function RunHistoryClient({ runs }: Props) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  return (
    <div>
      <Header title="Suivi des runs" subtitle="Historique technique des exécutions du pipeline" />

      <div className="p-4 sm:p-8">
        {runs.length === 0 ? (
          <div className="flex items-center gap-4 p-6 bg-navy-800/40 border border-dashed border-navy-600/50 rounded-2xl">
            <div className="w-12 h-12 rounded-xl bg-navy-700/60 flex items-center justify-center text-2xl">🛰️</div>
            <div>
              <div className="text-white font-medium">Aucun run enregistré</div>
              <div className="text-sm text-gray-500 mt-0.5">Le premier run apparaîtra ici après une génération.</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map(run => {
              const isExpanded = expandedRunId === run.runId
              return (
                <div key={run.runId} className="bg-navy-800/60 border border-navy-700/50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setExpandedRunId(isExpanded ? null : run.runId)}
                    className="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-navy-700/20 transition"
                  >
                    <div className="flex items-center gap-4 flex-wrap min-w-0">
                      <div>
                        <div className="text-sm font-medium text-white">
                          {new Date(run.startedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(run.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {formatDuration(run.startedAt, run.endedAt)} · {run.messageCount} messages
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {run.sessions.length === 0 ? (
                          <span className="text-xs text-gray-600 italic">Aucun palier produit</span>
                        ) : (
                          run.sessions.map((s, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[s.status] ?? 'bg-navy-700 text-gray-300'}`}
                            >
                              {TIER_LABELS[s.tier] ?? s.tier}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <span className="text-gray-500 text-sm flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                  {isExpanded && (
                    <div className="p-4 pt-0">
                      <LiveAgentJournal runId={run.runId} active={false} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
