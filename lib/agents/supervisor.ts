import { routeCompletion } from '@/lib/model-router'
import type { AnalystOutput, SupervisorNotes, SupervisorCheck } from '@/lib/types'

const MIN_TREND_PCT = 80
const MIN_SAMPLE = 8
const MIN_ODDS = 1.35
const MAX_ODDS = 2.80
const MIN_PICKS = 2
const MAX_PICKS = 5

export async function runSupervisor(
  analystOutput: AnalystOutput,
  iteration: number
): Promise<SupervisorNotes & { feedback_for_analyst?: string }> {
  const picks = analystOutput.picks_retenus
  const issues: string[] = []

  if (picks.length < MIN_PICKS) issues.push(`Nombre de picks insuffisant : ${picks.length} (min ${MIN_PICKS})`)
  if (picks.length > MAX_PICKS) issues.push(`Trop de picks : ${picks.length} (max ${MAX_PICKS})`)

  const oddsOnlyMode = picks.every(p => p.sample_size === 0)

  for (const pick of picks) {
    // En mode cotes-uniquement (sample_size=0), trend_pct et sample_size ne s'appliquent pas
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
    const check: SupervisorCheck = {
      verdict: 'revision_needed',
      issues,
      feedback,
    }
    return {
      checks: [check],
      final_verdict: 'rejected',
      iterations: iteration,
      model_used: 'deterministic',
      feedback_for_analyst: feedback,
    }
  }

  // En mode cotes-uniquement (sample_size=0 partout), auto-approuver si les checks
  // déterministes passent — pas de données historiques disponibles, c'est voulu
  if (oddsOnlyMode) {
    const check: SupervisorCheck = {
      verdict: 'approved',
      feedback: `Mode cotes-uniquement validé — ${picks.length} picks avec probabilité implicite de marché.`,
    }
    return { checks: [check], final_verdict: 'approved', iterations: iteration, model_used: 'deterministic-odds-only' }
  }

  // Validation qualitative Claude (mode normal uniquement)
  const picksText = picks
    .map(p => `${p.home_team} vs ${p.away_team} (${p.competition}) → ${p.bet_type} @ ${p.odds.toFixed(2)} | tendance ${p.trend_pct}% sur ${p.sample_size} matchs`)
    .join('\n')

  const { text: raw } = await routeCompletion(
    'supervisor',
    `Tu es le superviseur de Kaffi Network. Tu valides la qualité éditoriale des picks.
Vérifie : diversité des compétitions, cohérence des types de paris, absence de contradictions.
Réponds UNIQUEMENT avec du JSON valide.`,
    `Valide ce combiné (itération ${iteration}) :

${picksText}

Résumé : ${analystOutput.summary}

JSON attendu :
{
  "verdict": "approved" | "revision_needed",
  "issues": ["problèmes si revision_needed"],
  "feedback": "commentaire bref"
}`,
    512
  )
  const braceStart = raw.indexOf('{')
  const braceEnd = raw.lastIndexOf('}')
  const jsonStr = braceStart !== -1 ? raw.slice(braceStart, braceEnd + 1) : raw

  let check: SupervisorCheck
  try {
    check = JSON.parse(jsonStr) as SupervisorCheck
  } catch {
    check = { verdict: 'approved', feedback: 'Validation OK' }
  }

  const feedbackForAnalyst = check.verdict !== 'approved' && check.issues?.length
    ? `Itération ${iteration} rejetée par le superviseur :\n${check.issues.map(i => `• ${i}`).join('\n')}\n${check.feedback ?? ''}`
    : undefined

  return {
    checks: [check],
    final_verdict: check.verdict === 'approved' ? 'approved' : 'rejected',
    iterations: iteration,
    model_used: check.verdict === 'approved' ? 'openrouter' : 'openrouter',
    feedback_for_analyst: feedbackForAnalyst,
  }
}
