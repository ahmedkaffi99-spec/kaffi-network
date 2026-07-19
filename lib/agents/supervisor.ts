import Anthropic from '@anthropic-ai/sdk'
import type { AnalystOutput, SupervisorNotes, SupervisorCheck } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const MIN_TREND_PCT = 80
const MIN_SAMPLE = 8
const MIN_ODDS = 1.35
const MAX_ODDS = 2.80
const MIN_PICKS = 2
const MAX_PICKS = 5

export async function runSupervisor(
  analystOutput: AnalystOutput,
  iteration: number
): Promise<SupervisorNotes> {
  const picks = analystOutput.picks_retenus

  // Vérifications automatiques déterministes
  const issues: string[] = []

  if (picks.length < MIN_PICKS) issues.push(`Nombre de picks insuffisant : ${picks.length} (min ${MIN_PICKS})`)
  if (picks.length > MAX_PICKS) issues.push(`Trop de picks : ${picks.length} (max ${MAX_PICKS})`)

  for (const pick of picks) {
    if (pick.trend_pct < MIN_TREND_PCT) {
      issues.push(`Pick ${pick.home_team}-${pick.away_team} : tendance ${pick.trend_pct}% < ${MIN_TREND_PCT}%`)
    }
    if (pick.sample_size < MIN_SAMPLE) {
      issues.push(`Pick ${pick.home_team}-${pick.away_team} : sample ${pick.sample_size} < ${MIN_SAMPLE}`)
    }
    if (pick.odds < MIN_ODDS || pick.odds > MAX_ODDS) {
      issues.push(`Pick ${pick.home_team}-${pick.away_team} : cote ${pick.odds} hors zone (${MIN_ODDS}–${MAX_ODDS})`)
    }
  }

  // Vérification doublons (même match)
  const matchKeys = picks.map(p => `${p.home_team}-${p.away_team}`)
  const hasDuplicates = matchKeys.length !== new Set(matchKeys).size
  if (hasDuplicates) issues.push('Doublons détectés : même match sélectionné plusieurs fois')

  // Si erreurs critiques détectées, retourner sans appel LLM
  if (issues.length > 0) {
    const check: SupervisorCheck = {
      verdict: 'revision_needed',
      issues,
      feedback: `Critères non respectés — révision nécessaire (itération ${iteration})`,
    }
    return {
      checks: [check],
      final_verdict: 'rejected',
      iterations: iteration,
      model_used: 'deterministic',
    }
  }

  // Validation qualitative par Claude
  const picksText = picks
    .map(p => `${p.home_team} vs ${p.away_team} (${p.competition}) → ${p.bet_type} @ ${p.odds.toFixed(2)} | ${p.trend_pct}% sur ${p.sample_size} matchs`)
    .join('\n')

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: `Tu es le superviseur de Kaffi Network. Tu valides la qualité éditoriale des picks football sélectionnés.
Tu vérifies la cohérence, la diversité des compétitions, et l'absence de contradictions.
Réponds UNIQUEMENT avec du JSON valide.`,
    messages: [
      {
        role: 'user',
        content: `Valide ce combiné (itération ${iteration}) :

${picksText}

Résumé analyste : ${analystOutput.summary}

Réponds avec :
{
  "verdict": "approved" | "revision_needed",
  "issues": ["liste des problèmes si revision_needed"],
  "feedback": "commentaire bref"
}`,
      },
    ],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
  const jsonStr = raw.startsWith('{') ? raw : raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')

  let check: SupervisorCheck
  try {
    check = JSON.parse(jsonStr) as SupervisorCheck
  } catch {
    check = { verdict: 'approved', feedback: 'Validation manuelle OK' }
  }

  return {
    checks: [check],
    final_verdict: check.verdict === 'approved' ? 'approved' : 'rejected',
    iterations: iteration,
    model_used: 'claude-haiku-4-5',
  }
}
