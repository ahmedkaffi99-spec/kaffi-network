'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PronosticSession } from '@/lib/types'
import { Button } from '@/components/ui/Button'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-navy-700 text-gray-300',
  approved: 'bg-emerald-900/50 text-emerald-400 border border-emerald-700/50',
  published: 'bg-gold-500/20 text-gold-400 border border-gold-600/50',
  rejected: 'bg-red-900/40 text-red-400 border border-red-700/50',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  approved: 'Approuvé',
  published: 'Publié',
  rejected: 'Rejeté',
}

const TIER_STYLES: Record<string, string> = {
  prudent: 'bg-blue-900/30 text-blue-300 border border-blue-700/40',
  equilibre: 'bg-purple-900/30 text-purple-300 border border-purple-700/40',
  audacieux: 'bg-orange-900/30 text-orange-300 border border-orange-700/40',
}

const TIER_LABELS: Record<string, string> = {
  prudent: 'Prudent',
  equilibre: 'Équilibré',
  audacieux: 'Audacieux',
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
  onReject?: (id: string) => Promise<void>
  onPublish?: (id: string, file: File) => Promise<void>
}

export function SessionCard({ session, onApprove, onReject, onPublish }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [ticketFile, setTicketFile] = useState<File | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const router = useRouter()
  // was_rejected exclut les picks retirés via le chat (voir
  // app/api/sessions/[id]/apply-change) — même filtre que la page de détail.
  const picks = (session.picks ?? []).filter(p => !p.was_rejected)

  const winCount = picks.filter(p => p.result === 'win').length
  const lossCount = picks.filter(p => p.result === 'loss').length
  const pendingCount = picks.filter(p => !p.result).length

  async function handleApprove() {
    setLoading('approve')
    try {
      await onApprove?.(session.id)
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  async function handleReject() {
    setLoading('reject')
    try {
      await onReject?.(session.id)
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  async function handlePublish() {
    if (!ticketFile) return
    setLoading('publish')
    setPublishError(null)
    try {
      await onPublish?.(session.id, ticketFile)
      router.refresh()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Échec de la publication')
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
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${TIER_STYLES[session.tier] ?? ''}`}
            >
              {TIER_LABELS[session.tier] ?? session.tier}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[session.status]}`}
            >
              {STATUS_LABELS[session.status]}
            </span>
          </div>
        </div>

        {/* Result summary (if published) */}
        {session.status === 'published' && picks.some(p => p.result) && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-navy-900/60 rounded-xl">
            {session.combo_result && (
              <span
                className={`text-sm font-bold ${
                  session.combo_result === 'win' ? 'text-emerald-400' : session.combo_result === 'loss' ? 'text-red-400' : 'text-gray-400'
                }`}
              >
                {session.combo_result === 'win' ? '✅ GAGNÉ' : session.combo_result === 'loss' ? '❌ PERDU' : '➖ ANNULÉ'}
              </span>
            )}
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

        {/* Post rédigé — à lire avant d'approuver (le Superviseur, c'est toi) */}
        {session.status === 'draft' && session.writer_output && (
          <div className="mb-4">
            <div className="text-xs text-gray-500 mb-1.5">Post Telegram rédigé — à valider :</div>
            <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed bg-navy-900/60 border border-navy-700/40 rounded-xl p-3 max-h-64 overflow-y-auto">
              {session.writer_output}
            </pre>
          </div>
        )}

        {/* Notes */}
        {session.notes && (
          <div className="text-xs text-gray-500 mb-4 italic border-l-2 border-navy-600 pl-3">
            {session.notes}
          </div>
        )}

        {/* Toggle picks + lien détail */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 transition"
          >
            <span>{expanded ? '▲' : '▼'}</span>
            <span>{expanded ? 'Masquer' : 'Voir'} les picks</span>
          </button>
          <Link
            href={`/dashboard/pronostics/${session.id}`}
            className="text-xs text-gray-500 hover:text-gold-400 flex items-center gap-1 transition"
          >
            <span>Détail complet</span>
            <span>→</span>
          </Link>
        </div>

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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {session.status === 'published' && session.telegram_msg_id && (
            <span className="text-xs text-gray-600">
              ✈️ Publié · msg #{session.telegram_msg_id}
            </span>
          )}
          {session.status !== 'published' && session.status !== 'approved' && <div />}

          {session.status === 'draft' && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="danger" disabled={loading === 'reject'} onClick={handleReject}>
                {loading === 'reject' ? '...' : '✗ Rejeter'}
              </Button>
              <Button size="sm" variant="success" disabled={loading === 'approve'} onClick={handleApprove}>
                {loading === 'approve' ? '...' : '✓ Approuver'}
              </Button>
            </div>
          )}

          {session.status === 'approved' && (
            <div className="flex flex-col items-end gap-1.5 w-full sm:w-auto">
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <label className="text-xs text-gray-400 px-3 py-2 border border-navy-600/60 rounded-lg cursor-pointer hover:border-navy-500 transition truncate max-w-[220px]">
                  {ticketFile ? `📎 ${ticketFile.name}` : '📷 Choisir la capture 1xBet'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={e => setTicketFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <Button size="sm" variant="primary" disabled={!ticketFile || loading === 'publish'} onClick={handlePublish}>
                  {loading === 'publish' ? '...' : '🚀 Publier avec ma capture'}
                </Button>
              </div>
              {publishError && <span className="text-xs text-red-400">{publishError}</span>}
              <span className="text-xs text-gray-600">
                Envoie une capture du coupon réellement misé sur 1xBet — pas de publication sans capture.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
