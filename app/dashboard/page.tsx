'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { StatsWidget } from '@/components/StatsWidget'
import { SessionCard } from '@/components/SessionCard'
import { Header } from '@/components/Header'
import { Button } from '@/components/ui/Button'
import { mockStats, mockSessions } from '@/lib/mock-data'

export default function DashboardPage() {
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const router = useRouter()

  const todaySession = mockSessions.find(s => {
    const today = new Date().toISOString().split('T')[0]
    return s.date === today
  })

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch('/api/generate', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
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
  }

  async function handlePublish(id: string) {
    const res = await fetch(`/api/publish/${id}`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error)
    }
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
            disabled={generating || !!todaySession}
            onClick={handleGenerate}
          >
            {generating ? '⏳ Génération...' : todaySession ? '✓ Session du jour générée' : '⚡ Générer les picks'}
          </Button>
        }
      />

      <div className="p-8 space-y-6">
        {/* Error banner */}
        {genError && (
          <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-400 text-sm flex items-start gap-2">
            <span className="flex-shrink-0">⚠</span>
            <span>{genError}</span>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsWidget
            label="Sessions ce mois"
            value={mockStats.total_this_month}
            sub={`${mockStats.total_this_month} combinés`}
            icon="📋"
          />
          <StatsWidget
            label="Taux de réussite"
            value={`${mockStats.win_rate}%`}
            sub="Sur picks individuels"
            trend="up"
            icon="🎯"
            highlight
          />
          <StatsWidget
            label="À valider"
            value={mockStats.pending_review}
            sub="Sessions en attente"
            icon="⏳"
          />
          <StatsWidget
            label="ROI mensuel"
            value={`+${mockStats.roi_this_month}%`}
            sub="Objectif +10%"
            trend="up"
            icon="💰"
          />
        </div>

        {/* Today's session */}
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Session du jour
          </h2>
          {todaySession ? (
            <SessionCard
              session={todaySession}
              onApprove={handleApprove}
              onPublish={handlePublish}
            />
          ) : (
            <div className="flex items-center gap-4 p-6 bg-navy-800/40 border border-dashed border-navy-600/50 rounded-2xl">
              <div className="w-12 h-12 rounded-xl bg-navy-700/60 flex items-center justify-center text-2xl">
                ⚡
              </div>
              <div>
                <div className="text-white font-medium">Aucune session générée aujourd'hui</div>
                <div className="text-sm text-gray-500 mt-0.5">
                  Clique sur &ldquo;Générer les picks&rdquo; pour lancer l'analyse de Claude.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Streak banner */}
        <div className="bg-gradient-to-r from-gold-500/10 via-gold-500/5 to-transparent border border-gold-500/20 rounded-2xl p-5 flex items-center gap-4">
          <span className="text-4xl">🔥</span>
          <div>
            <div className="text-gold-400 font-bold text-lg">
              Série active : {mockStats.current_streak} picks gagnants consécutifs
            </div>
            <div className="text-gray-500 text-sm mt-0.5">
              Seuil de fiabilité à 80% — les algorithmes sont bien calibrés.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
