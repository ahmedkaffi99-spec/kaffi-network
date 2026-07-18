'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PronosticSession } from '@/lib/types'
import { Button } from '@/components/ui/Button'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-navy-700 text-gray-300',
  approved: 'bg-emerald-900/50 text-emerald-400 border border-emerald-700/50',
  published: 'bg-gold-500/20 text-gold-400 border border-gold-600/50',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  approved: 'Approuvé',
  published: 'Publié',
}

const COMPETITION_ICONS: Record<string, string> = {
  'Premier League': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Bundesliga': '🇩🇪',
  'La Liga': '🇪🇸',
  'Serie A': '🇮🇹',
  'Ligue 1': '🇫🇷',
  'UEFA Champions League': '🏆',
  'UEFA Europa League': '🥈',
  default: '⚽',
}

interface SessionCardProps {
  session: PronosticSession
  onApprove?: (id: string) => Promise<void>
  onPublish?: (id: string) => Promise<void>
}

export function SessionCard({ session, onApprove, onPublish }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const router = useRouter()
  const picks = session.picks ?? []

  const winCount = picks.filter(p => p.result === 'win').length
  const lossCount = picks.filter(p => p.result === 'loss').length
  const pendingCount = picks.filter(p => !p.result).length

  async function handleAction(action: 'approve' | 'publish') {
    setLoading(action)
    try {
      if (action === 'approve') await onApprove?.(session.id)
      if (action === 'publish') await onPublish?.(session.id)
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="bg-navy-800/60 border border-navy-700/50 rounded-2xl overflow-hidden hover:border-navy-600/60 transition-all duration-200">
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-gray-500 mb-1">
              {new Date(session.date).toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-white">
                {picks.length} pick{picks.length > 1 ? 's' : ''}
              </span>
              {session.combined_odds && (
                <span className="text-gold-400 font-bold text-lg">
                  × {session.combined_odds.toFixed(2)}
                </span>
              )}
            </div>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[session.status]}`}
          >
            {STATUS_LABELS[session.status]}
          </span>
        </div>

        {/* Result summary (if published) */}
        {session.status === 'published' && picks.some(p => p.result) && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-navy-900/60 rounded-xl">
            {winCount > 0 && (
              <span className="text-sm text-emerald-400 font-semibold">✓ {winCount} gagné{winCount > 1 ? 's' : ''}</span>
            )}
            {lossCount > 0 && (
              <span className="text-sm text-red-400 font-semibold">✗ {lossCount} perdu{lossCount > 1 ? 's' : ''}</span>
            )}
            {pendingCount > 0 && (
              <span className="text-sm text-gray-500">{pendingCount} en attente</span>
            )}
          </div>
        )}

        {/* Notes */}
        {session.notes && (
          <div className="text-xs text-gray-500 mb-4 italic border-l-2 border-navy-600 pl-3">
            {session.notes}
          </div>
        )}

        {/* Toggle picks */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 mb-4 transition"
        >
          <span>{expanded ? '▲' : '▼'}</span>
          <span>{expanded ? 'Masquer' : 'Voir'} les picks</span>
        </button>

        {/* Picks list */}
        {expanded && picks.length > 0 && (
          <div className="space-y-2 mb-4">
            {picks.map((pick, i) => {
              const icon =
                COMPETITION_ICONS[pick.competition] ?? COMPETITION_ICONS.default
              const resultColor =
                pick.result === 'win'
                  ? 'text-emerald-400'
                  : pick.result === 'loss'
                  ? 'text-red-400'
                  : 'text-gray-600'

              return (
                <div
                  key={pick.id}
                  className="flex items-start gap-3 p-3 bg-navy-900/60 border border-navy-700/30 rounded-xl"
                >
                  <span className="text-base mt-0.5">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs text-gray-500">{pick.competition}</span>
                        <div className="text-sm text-white font-medium mt-0.5">
                          {pick.home_team} - {pick.away_team}
                        </div>
                        <div className="text-sm text-gold-400 font-semibold mt-0.5">
                          {pick.bet_type}{' '}
                          <span className="text-gray-500 font-normal">@{pick.odds.toFixed(2)}</span>
                        </div>
                      </div>
                      {pick.result && (
                        <span className={`text-xs font-bold flex-shrink-0 ${resultColor}`}>
                          {pick.result === 'win' ? '✓ W' : pick.result === 'loss' ? '✗ L' : '~ V'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1.5 bg-navy-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gold-500/70 rounded-full"
                          style={{ width: `${pick.trend_pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 font-medium flex-shrink-0">
                        {pick.trend_pct}% / {pick.sample_size}m
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1 italic">{pick.trend_label}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          {session.status === 'published' && session.telegram_msg_id && (
            <span className="text-xs text-gray-600">
              ✈️ Publié · msg #{session.telegram_msg_id}
            </span>
          )}
          {session.status !== 'published' && <div />}

          <div className="flex items-center gap-2">
            {session.status === 'draft' && (
              <Button
                size="sm"
                variant="success"
                disabled={loading === 'approve'}
                onClick={() => handleAction('approve')}
              >
                {loading === 'approve' ? '...' : '✓ Approuver'}
              </Button>
            )}
            {session.status === 'approved' && (
              <Button
                size="sm"
                variant="primary"
                disabled={loading === 'publish'}
                onClick={() => handleAction('publish')}
              >
                {loading === 'publish' ? '...' : '🚀 Publier sur Telegram'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
