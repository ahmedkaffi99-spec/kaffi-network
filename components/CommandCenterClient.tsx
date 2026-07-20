'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/Header'
import { Button } from '@/components/ui/Button'
import { LiveAgentJournal } from '@/components/LiveAgentJournal'
import { SessionCard } from '@/components/SessionCard'
import type { PronosticSession } from '@/lib/types'

interface Props {
  todaySessions: PronosticSession[]
}

// Regroupe ce qui était éparpillé entre Dashboard (bouton générer + vue
// live) et Pronostics (actions approuver/rejeter/publier) — un seul endroit
// pour piloter le pipeline du jour. Le Dashboard (Vue d'ensemble) reste la
// page de stats pures ; ici c'est la salle de contrôle.
export function CommandCenterClient({ todaySessions }: Props) {
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [genResult, setGenResult] = useState<string | null>(null)
  const [liveRunId, setLiveRunId] = useState<string | null>(null)
  const router = useRouter()

  async function handleGenerate() {
    const runId = crypto.randomUUID()
    setLiveRunId(runId)
    setGenerating(true)
    setGenError(null)
    setGenResult(null)
    try {
      const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }) })
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
    if (!res.ok) { const data = await res.json(); throw new Error(data.error) }
    router.refresh()
  }

  async function handleReject(id: string) {
    const res = await fetch(`/api/sessions/${id}/reject`, { method: 'POST' })
    if (!res.ok) { const data = await res.json(); throw new Error(data.error) }
    router.refresh()
  }

  async function handlePublish(id: string, file: File) {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`/api/publish/${id}`, { method: 'POST', body: formData })
    if (!res.ok) { const data = await res.json(); throw new Error(data.error) }
    router.refresh()
  }

  return (
    <div>
      <Header
        title="Commandement"
        subtitle="Lance et pilote le pipeline du jour"
        actions={
          <Button variant="primary" size="md" disabled={generating || todaySessions.length >= 3} onClick={handleGenerate}>
            {generating ? '⏳ Génération...' : todaySessions.length >= 3 ? '✓ Les 3 paliers du jour sont générés' : '⚡ Générer les picks'}
          </Button>
        }
      />

      <div className="p-4 sm:p-8 space-y-6">
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

        {liveRunId && (
          <LiveAgentJournal runId={liveRunId} active={generating} onClose={() => setLiveRunId(null)} />
        )}

        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Combinés du jour
          </h2>
          {todaySessions.length ? (
            <div className="space-y-4">
              {todaySessions.map(session => (
                <SessionCard key={session.id} session={session} onApprove={handleApprove} onReject={handleReject} onPublish={handlePublish} />
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
      </div>
    </div>
  )
}
