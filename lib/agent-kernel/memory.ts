import { adminSupabase } from '@/lib/supabase/admin'
import { getAllPerformance, formatMemoryContext } from '@/lib/tools/memory'
import type { Blackboard } from './blackboard'
import type { BlackboardMessage } from './types'

/**
 * Mémoire moyen terme : fenêtre glissante en lecture seule, reconstruite en
 * mémoire à chaque run (pas de persistance dédiée — la source de vérité est
 * déjà `bet_performance`, alimentée par lib/tools/result-checker.ts).
 */
export async function loadMediumTermDigest(): Promise<string> {
  const performance = await getAllPerformance()
  return formatMemoryContext(performance)
}

interface LongTermRow {
  key: string
  value: string
  confidence: number | null
  updated_at: string
}

/**
 * Mémoire long terme : leçons distillées qui survivent aux runs individuels,
 * lues au début de chaque run et pliées dans le contexte des agents.
 */
export async function loadLongTermDigest(scope: string, limit = 12): Promise<string> {
  const { data } = await adminSupabase
    .from('agent_memory_long_term')
    .select('key, value, confidence, updated_at')
    .eq('scope', scope)
    .order('updated_at', { ascending: false })
    .limit(limit)

  const rows = (data ?? []) as LongTermRow[]
  if (!rows.length) return 'Aucune leçon long terme enregistrée.'

  return rows.map(r => `- ${r.value}${r.confidence != null ? ` (confiance ${Math.round(r.confidence * 100)}%)` : ''}`).join('\n')
}

/**
 * Écrit/actualise une leçon long terme. Appelé uniquement quand un agent en
 * produit une dans sa sortie structurée existante (ex: `lesson_for_memory`
 * du superviseur) — jamais via un appel LLM dédié, pour ne pas alourdir le
 * budget du run.
 */
export async function persistLongTermLesson(
  scope: string,
  key: string,
  value: string,
  confidence?: number
): Promise<void> {
  await adminSupabase
    .from('agent_memory_long_term')
    .upsert(
      { scope, key, value, confidence: confidence ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'scope,key' }
    )
}

/**
 * Persiste UN message du blackboard dès qu'il est posté — c'est ce qui
 * alimente la vue "live" du dashboard pendant qu'un run tourne (le dashboard
 * fait un polling sur agent_messages filtré par run_id). session_id reste
 * toujours null ici : au moment où le Planificateur/Analyste postent, aucune
 * session n'existe encore. persistRunTranscript() ci-dessous s'occupe
 * séparément de dupliquer le transcript complet avec le bon session_id une
 * fois qu'un palier existe, pour la vue "Journal des agents" par session.
 */
export async function persistLiveMessage(scope: string, runId: string, message: BlackboardMessage): Promise<void> {
  await adminSupabase.from('agent_messages').insert({
    run_id: runId,
    scope,
    session_id: null,
    from_role: message.from,
    to_role: message.to ?? null,
    type: message.type,
    content: message.content,
    created_at: message.createdAt,
  })
}

/**
 * Persiste le transcript du blackboard (communication inter-agents) à la fin
 * d'un run — mémoire court terme du run, conservée pour audit/dashboard.
 */
export async function persistRunTranscript(params: {
  scope: string
  sessionId?: string
  blackboard: Blackboard
}): Promise<void> {
  const messages = params.blackboard.transcript()
  if (!messages.length) return

  await adminSupabase.from('agent_messages').insert(
    messages.map(m => ({
      run_id: params.blackboard.runId,
      scope: params.scope,
      session_id: params.sessionId ?? null,
      from_role: m.from,
      to_role: m.to ?? null,
      type: m.type,
      content: m.content,
      created_at: m.createdAt,
    }))
  )
}
