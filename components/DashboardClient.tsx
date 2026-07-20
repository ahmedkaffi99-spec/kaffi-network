'use client'

import Link from 'next/link'
import { StatsWidget } from '@/components/StatsWidget'
import { Header } from '@/components/Header'
import { Button } from '@/components/ui/Button'
import type { DashboardStats } from '@/lib/types'

interface Props {
  stats: DashboardStats
}

// Vue d'ensemble = stats pures. Lancer un run et gérer les combinés du jour
// (approuver/rejeter/publier) se fait depuis Commandement, voir
// components/CommandCenterClient.tsx.
export function DashboardClient({ stats }: Props) {
  return (
    <div>
      <Header
        title="Vue d'ensemble"
        subtitle="Pipeline de pronostics · IA de Pronostics & Coupons"
        actions={
          <Link href="/dashboard/commandement">
            <Button variant="primary" size="md">🎛️ Aller au Commandement</Button>
          </Link>
        }
      />

      <div className="p-4 sm:p-8 space-y-6">
        {stats.pending_review > 0 && (
          <div className="p-4 bg-gold-500/10 border border-gold-500/25 rounded-xl text-sm flex items-center justify-between gap-3 flex-wrap">
            <span className="text-gold-300">
              ⏳ {stats.pending_review} session{stats.pending_review > 1 ? 's' : ''} en attente de ta validation.
            </span>
            <Link href="/dashboard/commandement" className="text-gold-400 font-medium hover:text-gold-300 transition">
              Voir au Commandement →
            </Link>
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
