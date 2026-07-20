import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/Header'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import type { PronosticSession, Pick, AgentMessageRow } from '@/lib/types'

const MESSAGE_TYPE_STYLES: Record<string, string> = {
  observation: 'text-blue-400',
  plan: 'text-purple-400',
  decision: 'text-gold-400',
  reflection: 'text-amber-400',
  action: 'text-emerald-400',
  result: 'text-gray-400',
}

export const dynamic = 'force-dynamic'

const RESULT_STYLES: Record<string, string> = {
  win: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/40',
  loss: 'bg-red-900/30 text-red-400 border-red-700/40',
  void: 'bg-gray-800/40 text-gray-400 border-gray-700/40',
}

const STATUS_STYLES: Record<string, string> = {
  published: 'bg-emerald-900/20 text-emerald-400 border-emerald-700/30',
  approved: 'bg-blue-900/20 text-blue-400 border-blue-700/30',
  draft: 'bg-yellow-900/20 text-yellow-400 border-yellow-700/30',
  rejected: 'bg-red-900/20 text-red-400 border-red-700/30',
}

const TIER_LABELS: Record<string, string> = {
  prudent: 'Prudent',
  equilibre: 'Équilibré',
  audacieux: 'Audacieux',
}

const COMBO_RESULT_STYLES: Record<string, string> = {
  win: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/40',
  loss: 'bg-red-900/30 text-red-400 border-red-700/40',
  void: 'bg-gray-800/40 text-gray-400 border-gray-700/40',
}

const COMBO_RESULT_LABELS: Record<string, string> = {
  win: '✅ GAGNÉ',
  loss: '❌ PERDU',
  void: '➖ ANNULÉ',
}

export default async function PronosticDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data }, { data: agentMessages }] = await Promise.all([
    supabase.from('pronostic_sessions').select('*, picks(*)').eq('id', id).single(),
    supabase
      .from('agent_messages')
      .select('*')
      .eq('session_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (!data) notFound()

  const session = data as PronosticSession
  const picks = (session.picks ?? []) as Pick[]
  const analystOutput = session.analyst_output
  const oddsSelectorOutput = session.odds_selector_output
  const messages = (agentMessages ?? []) as AgentMessageRow[]

  return (
    <div>
      <Header
        title={`Session du ${new Date(session.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        subtitle={`ID : ${session.id.slice(0, 8)}…`}
      />

      <div className="px-4 sm:px-8 pt-6">
        <Link
          href="/dashboard/pronostics"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gold-400 transition"
        >
          <span>←</span>
          <span>Retour aux pronostics</span>
        </Link>
      </div>

      <div className="p-4 sm:p-8 space-y-5">
        {/* Status + meta */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="px-3 py-1 text-xs font-semibold rounded-full border border-navy-600/50 bg-navy-800/40 text-gray-300">
            {TIER_LABELS[session.tier] ?? session.tier}
          </span>
          <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${STATUS_STYLES[session.status] ?? ''}`}>
            {session.status.toUpperCase()}
          </span>
          {session.combo_result && (
            <span className={`px-3 py-1 text-xs font-bold rounded-full border ${COMBO_RESULT_STYLES[session.combo_result] ?? ''}`}>
              {COMBO_RESULT_LABELS[session.combo_result] ?? session.combo_result}
            </span>
          )}
          {session.combined_odds && (
            <span className="px-3 py-1 text-xs font-semibold rounded-full border border-gold-500/30 bg-gold-500/10 text-gold-400">
              Cote combinée : {session.combined_odds.toFixed(2)}
            </span>
          )}
          {session.iterations > 0 && (
            <span className="px-3 py-1 text-xs rounded-full border border-navy-600/50 bg-navy-800/40 text-gray-400">
              {session.iterations} itération{session.iterations > 1 ? 's' : ''} de rédaction
            </span>
          )}
        </div>

        {/* Picks retenus */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-white text-sm">Picks retenus ({picks.filter(p => !p.was_rejected).length})</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {picks.filter(p => !p.was_rejected).length === 0 ? (
              <p className="text-gray-600 text-sm">Aucun pick retenu.</p>
            ) : (
              picks.filter(p => !p.was_rejected).map(pick => (
                <div key={pick.id} className="flex items-start gap-4 p-4 bg-navy-900/40 rounded-xl border border-navy-700/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-white font-semibold text-sm">{pick.home_team} — {pick.away_team}</span>
                      <span className="text-xs text-gray-500">{pick.competition}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-gold-400 text-sm font-medium">{pick.bet_type}</span>
                      <span className="text-gray-400 text-sm">@ {pick.odds.toFixed(2)}</span>
                      <span className="text-gray-500 text-xs">{pick.trend_pct}% sur {pick.sample_size} matchs</span>
                    </div>
                    {pick.match_datetime && (
                      <div className="text-xs text-gray-600 mt-1">
                        {new Date(pick.match_datetime).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                  {pick.result && (
                    <span className={`px-2 py-0.5 text-xs font-bold rounded border ${RESULT_STYLES[pick.result] ?? ''}`}>
                      {pick.result.toUpperCase()}
                    </span>
                  )}
                </div>
              ))
            )}
          </CardBody>
        </Card>

        {/* Analyse */}
        {analystOutput && (
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-white text-sm">Résumé analyste</h2>
            </CardHeader>
            <CardBody>
              {analystOutput.plan && (
                <p className="text-gray-500 text-xs italic mb-2">Plan : {analystOutput.plan}</p>
              )}
              <p className="text-gray-300 text-sm leading-relaxed">{analystOutput.summary}</p>
              {analystOutput.picks_rejetés?.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Picks rejetés</h3>
                  <div className="space-y-2">
                    {analystOutput.picks_rejetés.map((rp, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-red-500 flex-shrink-0">✗</span>
                        <span className="text-gray-400">{rp.match} — <span className="text-gray-500">{rp.raison}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Sélecteur de cotes — traçabilité inclusion/exclusion */}
        {oddsSelectorOutput && (
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-white text-sm">Sélecteur de cotes</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-gray-500 text-xs">
                {oddsSelectorOutput.reliable_picks.length} picks avec cote fiable · {oddsSelectorOutput.excluded_picks.length} rejetés
              </p>
              {oddsSelectorOutput.reliable_picks.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm gap-2 border-b border-navy-700/30 pb-2 last:border-0">
                  <span className="text-gray-300">{p.home_team} — {p.away_team}</span>
                  <span className="text-gold-400 text-xs">@{p.odds.toFixed(2)} · {p.odds_source}</span>
                </div>
              ))}
              {oddsSelectorOutput.excluded_picks.length > 0 && (
                <div className="mt-2">
                  <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Rejetés par le Sélecteur de cotes</h3>
                  <div className="space-y-2">
                    {oddsSelectorOutput.excluded_picks.map((ep, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-red-500 flex-shrink-0">✗</span>
                        <span className="text-gray-400">{ep.match} — <span className="text-gray-500">{ep.reason}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Post Writer */}
        {session.writer_output && (
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-white text-sm">Post Telegram (Writer)</h2>
            </CardHeader>
            <CardBody>
              <pre className="text-gray-300 text-xs font-mono whitespace-pre-wrap leading-relaxed bg-navy-900/60 rounded-lg p-4 overflow-x-auto">
                {session.writer_output}
              </pre>
            </CardBody>
          </Card>
        )}

        {/* Supervisor notes */}
        {session.supervisor_notes && (
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-white text-sm">Contrôles automatiques</h2>
            </CardHeader>
            <CardBody className="space-y-2">
              {session.supervisor_notes.checks.map((check, i) => (
                <div key={i} className={`p-3 rounded-lg text-sm border ${check.verdict === 'approved' ? 'bg-emerald-900/20 border-emerald-700/30 text-emerald-300' : 'bg-red-900/20 border-red-700/30 text-red-300'}`}>
                  <span className="font-semibold mr-2">{check.verdict === 'approved' ? '✓' : '✗'}</span>
                  {check.feedback}
                  {check.issues?.map((issue, j) => (
                    <div key={j} className="ml-4 mt-1 text-xs opacity-80">• {issue}</div>
                  ))}
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        {/* Notes */}
        {session.notes && (
          <Card>
            <CardHeader><h2 className="font-semibold text-white text-sm">Notes</h2></CardHeader>
            <CardBody><p className="text-gray-400 text-sm">{session.notes}</p></CardBody>
          </Card>
        )}

        {/* Journal des agents — communication inter-agents (blackboard) */}
        {messages.length > 0 && (
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-white text-sm">Journal des agents</h2>
            </CardHeader>
            <CardBody className="space-y-2">
              {messages.map(msg => (
                <div key={msg.id} className="flex items-start gap-3 text-sm py-1.5 border-b border-navy-700/30 last:border-0">
                  <span className="text-xs text-gray-600 mt-0.5 flex-shrink-0 font-mono">
                    {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="text-xs text-gray-500 flex-shrink-0 w-24">
                    {msg.from_role}{msg.to_role ? ` → ${msg.to_role}` : ''}
                  </span>
                  <span className={`text-xs uppercase tracking-wide flex-shrink-0 w-20 ${MESSAGE_TYPE_STYLES[msg.type] ?? 'text-gray-400'}`}>
                    {msg.type}
                  </span>
                  <span className="text-gray-300 flex-1">{msg.content}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
