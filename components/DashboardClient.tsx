'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { StatsWidget } from '@/components/StatsWidget'
import { SessionCard } from '@/components/SessionCard'
import { Header } from '@/components/Header'
import { Button } from '@/components/ui/Button'
import type { PronosticSession, DashboardStats } from '@/lib/types'

interface Props {
  todaySessions: PronosticSession[]
  stats: DashboardStats
}

export function DashboardClient({ todaySessions, stats }: Props) {
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [genResult, setGenResult] = useState<string | null>(null)
  const router = useRouter()

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    setGenResult(null)
    try {
      const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? data.message)
      setGenResult(data.message)
      router.refresh()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erreur lors de la génération')
    } finally {
      setGenerating(false)
    }
  }

  async function handleApprove(id: string) {
    const res = await fetch(`/api/sessions/${id}/approve`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error)
    }
    router.refresh()
  }

  async function handlePublish(id: string) {
    const res = await fetch(`/api/publish/${id}`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error)
    }
    router.refresh()
  }

  return (
    <div>
      <Header
        title="Vue d'ensemble"
        subtitle="Pipeline de pronostics · Kaffi Network"
        actions={
          <Button
            variant="primary"
            size="md"
            disabled={generating || todaySessions.length >= 3}
            onClick={handleGenerate}
          >
            {generating ? '⏳ Génération...' : todaySessions.length >= 3 ? '✓ Les 3 paliers du jour sont générés' : '⚡ Générer les picks'}
          </Button>
        }
      />

      <div className="p-8 space-y-6">
        {genError && (
          <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-400 text-sm flex items-start gap-2">
            <span className="flex-shrink-0">⚠</span>
            <span>{genError}</span>
          </div>
        )}

        {genResult && (
          <div className="p-4 bg-emerald-900/20 border border-emerald-700/40 rounded-xl text-emerald-400 text-sm">
            {genResult}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsWidget label="Sessions ce mois" value={stats.total_this_month} sub={`${stats.total_this_month} combinés`} icon="📋" />
          <StatsWidget label="Taux de réussite" value={`${stats.win_rate}%`} sub="Sur picks individuels" trend="up" icon="🎯" highlight />
          <StatsWidget label="À valider" value={stats.pending_review} sub="Sessions en attente" icon="⏳" />
          <StatsWidget label="Streak actif" value={`${stats.current_streak}W`} sub="Combinés gagnants" trend="up" icon="🔥" />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Combinés publiés — statut
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsWidget label="En cours" value={stats.combos_en_cours} sub="Matchs pas tous terminés" icon="⏱️" />
            <StatsWidget label="Terminés" value={stats.combos_termines} sub="Résultat annoncé" icon="🏁" />
            <StatsWidget label="Gagnés" value={stats.combos_gagnes} sub="Sur les combinés terminés" trend="up" icon="✅" />
            <StatsWidget label="Perdus" value={stats.combos_perdus} sub="Sur les combinés terminés" icon="❌" />
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Combinés du jour
          </h2>
          {todaySessions.length ? (
            <div className="space-y-4">
              {todaySessions.map(session => (
                <SessionCard key={session.id} session={session} onApprove={handleApprove} onPublish={handlePublish} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-4 p-6 bg-navy-800/40 border border-dashed border-navy-600/50 rounded-2xl">
              <div className="w-12 h-12 rounded-xl bg-navy-700/60 flex items-center justify-center text-2xl">⚡</div>
              <div>
                <div className="text-white font-medium">Aucun combiné généré aujourd&apos;hui</div>
                <div className="text-sm text-gray-500 mt-0.5">Clique sur &ldquo;Générer les picks&rdquo; pour lancer l&apos;analyse.</div>
              </div>
            </div>
          )}
        </div>

        {stats.current_streak > 0 && (
          <div className="bg-gradient-to-r from-gold-500/10 via-gold-500/5 to-transparent border border-gold-500/20 rounded-2xl p-5 flex items-center gap-4">
            <span className="text-4xl">🔥</span>
            <div>
              <div className="text-gold-400 font-bold text-lg">
                Série active : {stats.current_streak} combiné{stats.current_streak > 1 ? 's' : ''} gagnant{stats.current_streak > 1 ? 's' : ''} consécutif{stats.current_streak > 1 ? 's' : ''}
              </div>
              <div className="text-gray-500 text-sm mt-0.5">Seuil de fiabilité à 80% — les algorithmes sont bien calibrés.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
