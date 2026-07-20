import { createClient } from '@/lib/supabase/server'
import { RunHistoryClient, type RunSummary } from '@/components/RunHistoryClient'

export const dynamic = 'force-dynamic'
const SCOPE = 'pronostics-foot'

export default async function RunHistoryPage() {
  const supabase = await createClient()

  const [{ data: messages }, { data: sessions }] = await Promise.all([
    supabase
      .from('agent_messages')
      .select('run_id, created_at')
      .eq('scope', SCOPE)
      .order('created_at', { ascending: false })
      .limit(3000),
    supabase
      .from('pronostic_sessions')
      .select('run_id, tier, status, date, combined_odds')
      .not('run_id', 'is', null)
      .order('date', { ascending: false })
      .limit(300),
  ])

  // Agrégation en JS — Supabase-js ne fait pas de GROUP BY arbitraire, et le
  // volume ici (quelques milliers de lignes max) est négligeable pour une
  // page admin peu visitée.
  const runMap = new Map<string, RunSummary>()

  for (const msg of messages ?? []) {
    const runId = msg.run_id as string
    const existing = runMap.get(runId)
    if (!existing) {
      runMap.set(runId, { runId, startedAt: msg.created_at, endedAt: msg.created_at, messageCount: 1, sessions: [] })
    } else {
      existing.messageCount++
      if (msg.created_at < existing.startedAt) existing.startedAt = msg.created_at
      if (msg.created_at > existing.endedAt) existing.endedAt = msg.created_at
    }
  }

  for (const s of sessions ?? []) {
    const run = runMap.get(s.run_id as string)
    if (run) run.sessions.push({ tier: s.tier, status: s.status, date: s.date, combined_odds: s.combined_odds })
  }

  const runs = [...runMap.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  return <RunHistoryClient runs={runs} />
}
