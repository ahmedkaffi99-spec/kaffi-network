import { parseAgentJSON, callAgentModel, renderMission } from '@/lib/agent-kernel'
import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { RunBudget, AgentMission } from '@/lib/agent-kernel/types'
import type { AnalystOutput, SupervisorNotes, SupervisorCheck } from '@/lib/types'

const MIN_TREND_PCT = 80
const MIN_SAMPLE = 8
const MIN_ODDS = 1.35
const MAX_ODDS = 2.80
const MIN_PICKS = 2
const MAX_PICKS = 5

const MISSION: AgentMission = {
  role: 'supervisor',
  label: 'le Superviseur',
  responsibility:
    "valider strictement la qualité et l'intégrité des picks retenus par l'Analyste avant toute publication — dernier garde-fou du crew.",
  doesNot: [
    "Ne sélectionne ni ne modifie aucun pick lui-même — renvoie un feedback à l'Analyste pour révision.",
    'Ne rédige pas le post Telegram.',
    'Ne publie jamais rien directement.',
  ],
}

export interface SupervisorResult extends SupervisorNotes {
  feedback_for_analyst?: string
  lesson_for_memory?: string
}

export async function runSupervisor(
  analystOutput: AnalystOutput,
  iteration: number,
  blackboard: Blackboard,
  budget: RunBudget
): Promise<SupervisorResult> {
  const picks = analystOutput.picks_retenus
  const issues: string[] = []

  if (picks.length < MIN_PICKS) issues.push(`Nombre de picks insuffisant : ${picks.length} (min ${MIN_PICKS})`)
  if (picks.length > MAX_PICKS) issues.push(`Trop de picks : ${picks.length} (max ${MAX_PICKS})`)

  const oddsOnlyMode = picks.every(p => p.sample_size === 0)

  for (const pick of picks) {
    if (!oddsOnlyMode && pick.trend_pct < MIN_TREND_PCT)
      issues.push(`${pick.home_team}-${pick.away_team} : tendance ${pick.trend_pct}% < ${MIN_TREND_PCT}% requis`)
    if (!oddsOnlyMode && pick.sample_size < MIN_SAMPLE)
      issues.push(`${pick.home_team}-${pick.away_team} : seulement ${pick.sample_size} matchs < ${MIN_SAMPLE} requis`)
    if (pick.odds < MIN_ODDS || pick.odds > MAX_ODDS)
      issues.push(`${pick.home_team}-${pick.away_team} : cote ${pick.odds} hors plage ${MIN_ODDS}–${MAX_ODDS}`)
  }

  const matchKeys = picks.map(p => `${p.home_team}-${p.away_team}`)
  if (matchKeys.length !== new Set(matchKeys).size)
    issues.push('Doublons : même match sélectionné plusieurs fois')

  if (issues.length > 0) {
    const feedback = `Itération ${iteration} rejetée. Corrections obligatoires :\n${issues.map(i => `• ${i}`).join('\n')}\nSélectionne d'autres matchs ou types de paris qui respectent strictement les critères.`
    const check: SupervisorCheck = { verdict: 'revision_needed', issues, feedback }
    blackboard.post({ from: 'supervisor', to: 'analyst', type: 'reflection', content: feedback })
    return {
      checks: [check],
      final_verdict: 'rejected',
      iterations: iteration,
      model_used: 'deterministic',
      feedback_for_analyst: feedback,
    }
  }

  if (oddsOnlyMode) {
    const feedback = `Mode cotes-uniquement validé — ${picks.length} picks avec probabilité implicite de marché.`
    const check: SupervisorCheck = { verdict: 'approved', feedback }
    blackboard.post({ from: 'supervisor', type: 'decision', content: feedback })
    return { checks: [check], final_verdict: 'approved', iterations: iteration, model_used: 'deterministic-odds-only' }
  }

  // Validation qualitative — seule étape de ce agent qui appelle le modèle.
  const picksText = picks
    .map(p => `${p.home_team} vs ${p.away_team} (${p.competition}) → ${p.bet_type} @ ${p.odds.toFixed(2)} | tendance ${p.trend_pct}% sur ${p.sample_size} matchs`)
    .join('\n')

  const system = `${renderMission(MISSION)}

VÉRIFICATIONS OBLIGATOIRES :
1. Diversité des compétitions (pas 3 picks dans la même ligue)
2. Cohérence des types de paris avec les données fournies
3. Absence de contradictions entre picks (ex: over ET under sur le même match)
4. Aucune stat inventée : chaque chiffre doit venir des données analytiques fournies
5. INTERDIT d'approuver un pick dont la justification contient : "garanti", "sûr à 100%", "infaillible", "sans risque"
6. Signale tout pick qui semble basé sur des données non vérifiables

Sois STRICT : un doute = revision_needed. Ne valide que ce qui est solide.
Réponds UNIQUEMENT avec du JSON valide.`

  const userMessage = `Valide ce combiné (itération ${iteration}) :

${picksText}

Résumé : ${analystOutput.summary}

JSON attendu :
{
  "verdict": "approved" | "revision_needed",
  "issues": ["problèmes si revision_needed"],
  "feedback": "commentaire bref",
  "lesson_for_memory": "optionnel — une leçon durable à retenir pour les prochains runs si tu observes un pattern notable (sinon omets ce champ)"
}`

  const { text: raw } = await callAgentModel('supervisor', system, userMessage, 512, blackboard, budget)

  // Fail-closed : une réponse illisible ne doit JAMAIS valider les picks par
  // défaut — c'est le dernier garde-fou avant publication automatique.
  const fallback: SupervisorCheck = {
    verdict: 'revision_needed',
    issues: ['Réponse du superviseur illisible (JSON invalide) — validation impossible'],
    feedback: "Le superviseur n'a pas pu être validé automatiquement, nouvelle tentative requise.",
  }
  const check = parseAgentJSON<SupervisorCheck & { lesson_for_memory?: string }>(raw, fallback)

  const feedbackForAnalyst = check.verdict !== 'approved' && check.issues?.length
    ? `Itération ${iteration} rejetée par le superviseur :\n${check.issues.map(i => `• ${i}`).join('\n')}\n${check.feedback ?? ''}`
    : undefined

  blackboard.post({
    from: 'supervisor',
    to: check.verdict === 'approved' ? 'all' : 'analyst',
    type: check.verdict === 'approved' ? 'decision' : 'reflection',
    content: check.feedback ?? (check.verdict === 'approved' ? 'Approuvé.' : 'Révision demandée.'),
  })

  return {
    checks: [check],
    final_verdict: check.verdict === 'approved' ? 'approved' : 'rejected',
    iterations: iteration,
    model_used: 'openrouter',
    feedback_for_analyst: feedbackForAnalyst,
    lesson_for_memory: check.lesson_for_memory,
  }
}
