import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { routeCompletion } from '@/lib/model-router'
import { parseAgentJSON } from '@/lib/agent-kernel'
import type { PronosticSession, Pick } from '@/lib/types'

const MAX_HISTORY = 12
const MAX_MESSAGE_LEN = 2000

type ChatAgent = 'analyst' | 'writer'

const AGENT_LABEL: Record<ChatAgent, string> = {
  analyst: "l'Analyste",
  writer: 'le Rédacteur',
}

type ProposedChange =
  | { type: 'rewrite_post'; new_text: string }
  | { type: 'remove_pick'; home_team: string; away_team: string; bet_type: string }

interface ChatModelReply {
  reply: string
  proposed_change: ProposedChange | null
}

// Discussion ad-hoc sur UNE session déjà produite — ne fait pas partie du
// pipeline borné (pas de Blackboard/RunBudget ici). Le modèle peut proposer
// UN changement structuré (proposed_change) quand l'utilisateur le demande
// explicitement, mais ne l'applique jamais lui-même : c'est le bouton
// "Appliquer ce changement" (components/SessionChat.tsx →
// app/api/sessions/[id]/apply-change) qui fait autorité, jamais le chat seul.
function buildSystemPrompt(agent: ChatAgent, session: PronosticSession, picks: Pick[]): string {
  const picksText = picks
    .filter(p => !p.was_rejected)
    .map(p => `- ${p.home_team} vs ${p.away_team} (${p.competition}) → ${p.bet_type} @ ${p.odds.toFixed(2)} — tendance ${p.trend_pct}% sur ${p.sample_size} matchs (${p.trend_label})`)
    .join('\n') || 'Aucun pick retenu dans ce combiné.'

  const rejectedText = session.analyst_output?.picks_rejetés?.length
    ? session.analyst_output.picks_rejetés.map(rp => `- ${rp.match} (${rp.competition})${rp.bet_type ? ` — ${rp.bet_type}` : ''} : ${rp.raison}`).join('\n')
    : 'Aucun.'

  const excludedByOdds = session.odds_selector_output?.excluded_picks?.length
    ? session.odds_selector_output.excluded_picks.map(ep => `- ${ep.match} (${ep.bet_type}) : ${ep.reason}`).join('\n')
    : 'Aucun.'

  const commonContext = `PALIER : ${session.tier} — cote combinée ${session.combined_odds ?? '—'}
STATUT : ${session.status}
${session.notes ? `NOTES : ${session.notes}` : ''}

PICKS RETENUS DANS CE COMBINÉ :
${picksText}

PICKS ÉCARTÉS PAR L'ANALYSTE (tendance/cote insuffisante) :
${rejectedText}

PICKS ÉCARTÉS PAR LE SÉLECTEUR DE COTES (marché bookmaker jugé peu fiable) :
${excludedByOdds}

RÉSUMÉ DE L'ANALYSTE : ${session.analyst_output?.summary ?? 'Non disponible.'}
${session.analyst_output?.plan ? `PLAN SUIVI PAR L'ANALYSTE : ${session.analyst_output.plan}` : ''}

POST TELEGRAM RÉDIGÉ : ${session.writer_output ?? 'Non disponible.'}`

  const roleInstructions =
    agent === 'analyst'
      ? "Tu ES l'Analyste qui a produit cette sélection — explique tes choix (pourquoi ces picks, pourquoi tel pick a été écarté) en te basant STRICTEMENT sur les données ci-dessous."
      : "Tu ES le Rédacteur qui a écrit ce post Telegram — explique tes choix de ton, de formulation, de mise en avant des picks, en te basant STRICTEMENT sur les données ci-dessous."

  const changeInstructions =
    agent === 'writer'
      ? `Si l'utilisateur demande EXPLICITEMENT de réécrire/modifier le post (pas juste une question), inclus "proposed_change": { "type": "rewrite_post", "new_text": "le texte COMPLET réécrit du post" }. "new_text" doit être le post entier prêt à publier, pas un extrait.`
      : `Si l'utilisateur demande EXPLICITEMENT de retirer un pick précis de ce combiné (pas juste une question), inclus "proposed_change": { "type": "remove_pick", "home_team": "...", "away_team": "...", "bet_type": "..." } — copie EXACTEMENT ces trois valeurs depuis "PICKS RETENUS" ci-dessus, sans les reformuler. Tu ne peux PAS ajouter ou remplacer un pick par un autre — seulement en retirer un existant.`

  return `${roleInstructions}

RÈGLES ABSOLUES :
- N'invente JAMAIS une statistique, une cote ou un match qui n'est pas dans les données ci-dessous.
- Si une question porte sur une donnée absente, dis clairement que tu ne l'as pas plutôt que de deviner.
- Réponds en français, de façon concise (quelques phrases), sans jargon inutile.
- ${changeInstructions}
- Ne mets "proposed_change" à autre chose que null QUE si l'utilisateur demande clairement un changement — jamais pour une simple question ou une explication.

Réponds UNIQUEMENT avec du JSON valide, structure exacte :
{
  "reply": "ta réponse conversationnelle",
  "proposed_change": null
}

DONNÉES DE CETTE SESSION :
${commonContext}`
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const agent: ChatAgent = body?.agent === 'writer' ? 'writer' : 'analyst'
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : ''
  const history: unknown[] = Array.isArray(body?.history) ? body.history.slice(-MAX_HISTORY) : []

  if (!message) {
    return NextResponse.json({ error: 'Message vide.' }, { status: 400 })
  }

  const { data: session } = await supabase
    .from('pronostic_sessions')
    .select('*, picks(*)')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })

  const typedSession = session as PronosticSession
  const picks = (session.picks ?? []) as Pick[]

  const systemPrompt = buildSystemPrompt(agent, typedSession, picks)
  const conversation = [
    ...history
      .filter((h: unknown): h is { role: string; content: string } =>
        !!h && typeof h === 'object' && 'role' in h && 'content' in h
      )
      .map(h => `${h.role === 'user' ? 'Utilisateur' : AGENT_LABEL[agent]} : ${String(h.content).slice(0, MAX_MESSAGE_LEN)}`),
    `Utilisateur : ${message}`,
  ].join('\n\n')

  const { text, model_used } = await routeCompletion(agent, systemPrompt, conversation, 768)

  if (!text) {
    return NextResponse.json({ error: 'Aucun modèle disponible pour répondre — réessaie dans un instant.' }, { status: 502 })
  }

  // Fail-closed : si le JSON est illisible, on affiche le texte brut comme
  // réponse mais on ne propose JAMAIS de changement à partir d'une sortie
  // qu'on n'a pas pu parser correctement.
  const fallback: ChatModelReply = { reply: text, proposed_change: null }
  const parsed = parseAgentJSON<ChatModelReply>(text, fallback)

  return NextResponse.json({ reply: parsed.reply || text, proposed_change: parsed.proposed_change ?? null, model_used })
}
