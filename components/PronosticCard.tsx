'use client'

import { useState } from 'react'
import type { Pronostic } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { StatusBadge, ResultBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

interface PronosticCardProps {
  pronostic: Pronostic
  onStatusChange?: (id: string, status: string) => void
}

const COMPETITION_ICONS: Record<string, string> = {
  'Ligue des Champions': '🏆',
  'Premier League': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Ligue 1': '🇫🇷',
  'Bundesliga': '🇩🇪',
  'La Liga': '🇪🇸',
  'Serie A': '🇮🇹',
}

export function PronosticCard({ pronostic, onStatusChange }: PronosticCardProps) {
  const [expanded, setExpanded] = useState(false)

  const competitionIcon = COMPETITION_ICONS[pronostic.competition] ?? '⚽'

  return (
    <div className="bg-navy-800/60 border border-navy-700/50 rounded-2xl overflow-hidden hover:border-navy-600/70 transition-all duration-200 group">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-navy-700/80 flex items-center justify-center text-xl flex-shrink-0">
              {competitionIcon}
            </div>
            <div className="min-w-0">
              <div className="text-xs text-gray-500 uppercase tracking-wider truncate">
                {pronostic.competition}
              </div>
              <div className="font-semibold text-white text-sm mt-0.5 leading-tight">
                {pronostic.match}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <StatusBadge status={pronostic.status} />
            {pronostic.result && <ResultBadge result={pronostic.result} />}
          </div>
        </div>

        {/* Prediction block */}
        <div className="bg-navy-900/60 border border-navy-700/30 rounded-xl p-3.5 mb-4">
          <div className="text-xs text-gray-500 mb-1">Pronostic IA</div>
          <div className="text-white font-semibold">{pronostic.prediction}</div>

          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Cote</span>
              <span className="text-gold-400 font-bold text-sm">{pronostic.odds.toFixed(2)}</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">Confiance</span>
                <span
                  className={`text-xs font-bold ${
                    pronostic.confidence >= 75
                      ? 'text-gold-400'
                      : pronostic.confidence >= 60
                      ? 'text-amber-400'
                      : 'text-gray-400'
                  }`}
                >
                  {pronostic.confidence}%
                </span>
              </div>
              <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    pronostic.confidence >= 75
                      ? 'bg-gold-500'
                      : pronostic.confidence >= 60
                      ? 'bg-amber-500'
                      : 'bg-gray-600'
                  }`}
                  style={{ width: `${pronostic.confidence}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible reasoning */}
        {pronostic.reasoning && (
          <div className="mb-4">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 transition"
            >
              <span className="text-xs">{expanded ? '▲' : '▼'}</span>
              <span>Analyse IA</span>
            </button>
            {expanded && (
              <div className="mt-2.5 text-sm text-gray-400 leading-relaxed border-l-2 border-gold-500/30 pl-3">
                {pronostic.reasoning}
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {pronostic.notes && (
          <div className="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-800/30 rounded-lg px-3 py-2 mb-4 flex gap-2">
            <span className="flex-shrink-0">📝</span>
            <span>{pronostic.notes}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">{formatDate(pronostic.generated_at)}</span>

          <div className="flex items-center gap-2">
            {pronostic.status === 'draft' && (
              <>
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => onStatusChange?.(pronostic.id, 'approved')}
                >
                  ✓ Approuver
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onStatusChange?.(pronostic.id, 'rejected')}
                >
                  ✗ Rejeter
                </Button>
              </>
            )}
            {pronostic.status === 'approved' && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => onStatusChange?.(pronostic.id, 'published')}
              >
                🚀 Publier
              </Button>
            )}
            {(pronostic.status === 'draft' || pronostic.status === 'approved') && (
              <Button size="sm" variant="ghost">
                ✏️
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
