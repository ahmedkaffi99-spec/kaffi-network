import { routeCompletion } from '@/lib/model-router'
import type { PlannerOutput, AnalystOutput } from '@/lib/types'
import { getTodayMatches, buildMatchAnalysisData, type TodayMatch, type TeamMatchResult } from '@/lib/tools/football-api'
import { getTodayOdds, findMatchOdds } from '@/lib/tools/odds-api'
import { getAllPerformance, formatMemoryContext } from '@/lib/tools/memory'
import { checkTeamNews } from '@/lib/tools/serper'

const MIN_TREND_PCT = 80
const MIN_SAMPLE = 8
const MIN_ODDS = 1.35
const MAX_ODDS = 2.80
const MAX_PICKS = 5

function calcTrend(history: TeamMatchResult[], predicate: (m: TeamMatchResult) => boolean): { pct: number; count: number } {
  if (!history.length) return { pct: 0, count: 0 }
  const matching = history.filter(predicate).length
  return { pct: Math.round((matching / history.length) * 100), count: history.length }
}

function extractJson(text: string): string {
  // Cherche un bloc JSON valide n'importe où dans le texte
  const fenceMatch = text.match(/```json?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  const braceStart = text.indexOf('{')
  const braceEnd = text.lastIndexOf('}')
  if (braceStart !== -1 && braceEnd > braceStart) return text.slice(braceStart, braceEnd + 1)
  return text.trim()
}

export async function runAnalyst(
  plannerOutput: PlannerOutput,
  supervisorFeedback?: string
): Promise<AnalystOutput> {
  const [matches, odds, performance] = await Promise.all([
    getTodayMatches(),
    getTodayOdds(),
    getAllPerformance(),
  ])

  const memoryContext = formatMemoryContext(performance)

  const relevantMatches = matches.filter((m: TodayMatch) =>
    plannerOutput.competitions.some(c =>
      m.competition.toLowerCase().includes(c.toLowerCase().split(' ')[0])
    )
  ).slice(0, 15)

  const analysisData = await buildMatchAnalysisData(relevantMatches)

  const enriched: string[] = []

  for (const { match, home_team_last_matches, away_team_last_matches } of analysisData) {
    const matchOdds = findMatchOdds(odds, match.home_team.name, match.away_team.name)
    if (!matchOdds) continue

    const homeH = home_team_last_matches
    const awayH = away_team_last_matches

    const homeOver25 = calcTrend(homeH, m => m.total_goals > 2.5)
    const awayOver25 = calcTrend(awayH, m => m.total_goals > 2.5)
    const homeUnder25 = calcTrend(homeH, m => m.total_goals < 2.5)
    const awayUnder25 = calcTrend(awayH, m => m.total_goals < 2.5)
    const homeBtts = calcTrend(homeH, m => m.goals_for > 0 && m.goals_against > 0)
    const awayBtts = calcTrend(awayH, m => m.goals_for > 0 && m.goals_against > 0)
    const homeWins = calcTrend(homeH, m => m.result === 'W' && m.home)

    const oddsLines: string[] = []
    const { home, draw, away } = matchOdds.h2h
    if (home != null && home >= MIN_ODDS && home <= MAX_ODDS) oddsLines.push(`Victoire domicile: ${home.toFixed(2)}`)
    if (draw != null && draw >= MIN_ODDS && draw <= MAX_ODDS) oddsLines.push(`Match nul: ${draw.toFixed(2)}`)
    if (away != null && away >= MIN_ODDS && away <= MAX_ODDS) oddsLines.push(`Victoire extérieur: ${away.toFixed(2)}`)

    const { over_2_5, under_2_5 } = matchOdds.totals
    if (over_2_5 != null && over_2_5 >= MIN_ODDS && over_2_5 <= MAX_ODDS) oddsLines.push(`Plus de 2.5: ${over_2_5.toFixed(2)}`)
    if (under_2_5 != null && under_2_5 >= MIN_ODDS && under_2_5 <= MAX_ODDS) oddsLines.push(`Moins de 2.5: ${under_2_5.toFixed(2)}`)

    const { yes, no } = matchOdds.btts
    if (yes != null && yes >= MIN_ODDS && yes <= MAX_ODDS) oddsLines.push(`BTTS Oui: ${yes.toFixed(2)}`)
    if (no != null && no >= MIN_ODDS && no <= MAX_ODDS) oddsLines.push(`BTTS Non: ${no.toFixed(2)}`)

    if (!oddsLines.length) continue

    // Actualités blessures/suspensions (en parallèle pour les deux équipes)
    const [homeNews, awayNews] = await Promise.all([
      checkTeamNews(match.home_team.name),
      checkTeamNews(match.away_team.name),
    ])

    enriched.push(`MATCH: ${match.home_team.name} vs ${match.away_team.name} (${match.competition}) — ${match.datetime}
Domicile ${match.home_team.name} (${homeH.length} matchs): over2.5=${homeOver25.pct}%, under2.5=${homeUnder25.pct}%, btts=${homeBtts.pct}%, wins_home=${homeWins.pct}%
Extérieur ${match.away_team.name} (${awayH.length} matchs): over2.5=${awayOver25.pct}%, under2.5=${awayUnder25.pct}%, btts=${awayBtts.pct}%
Actualités ${match.home_team.name}: ${homeNews}
Actualités ${match.away_team.name}: ${awayNews}
Cotes disponibles (${MIN_ODDS}–${MAX_ODDS}): ${oddsLines.join(', ')}`)
  }

  if (!enriched.length) {
    return {
      picks_retenus: [],
      picks_rejetés: [],
      summary: "Aucun match éligible trouvé pour aujourd'hui.",
      model_used: 'none',
    }
  }

  const systemPrompt = `Tu es l'analyste expert de Kaffi Network. Tu sélectionnes des picks football à haute valeur statistique.

RÈGLES ABSOLUES — tout pick qui ne respecte pas ces critères DOIT être rejeté sans exception :
1. Tendance ≥ ${MIN_TREND_PCT}% calculée sur ≥ ${MIN_SAMPLE} matchs récents
2. Cote entre ${MIN_ODDS} et ${MAX_ODDS} inclus
3. Maximum ${MAX_PICKS} picks retenus dans picks_retenus
4. Si les actualités signalent une blessure clé ou suspension de titulaire, rejeter le pick concerné

MÉMOIRE DE PERFORMANCE HISTORIQUE (pondère tes choix en conséquence) :
${memoryContext || 'Aucun historique disponible — première analyse.'}

${supervisorFeedback ? `FEEDBACK SUPERVISEUR À CORRIGER IMPÉRATIVEMENT :\n${supervisorFeedback}\n` : ''}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après :
{
  "picks_retenus": [
    {
      "competition": "string",
      "home_team": "string",
      "away_team": "string",
      "match_datetime": "ISO 8601",
      "bet_type": "string (ex: Plus de 2.5, BTTS Oui, Victoire domicile)",
      "odds": number,
      "trend_label": "string courte (ex: 9/10 matchs over 2.5)",
      "trend_pct": number,
      "sample_size": number
    }
  ],
  "picks_rejetés": [
    { "match": "string", "competition": "string", "bet_type": "string", "raison": "string" }
  ],
  "summary": "string (2-3 phrases sur la sélection du jour)"
}`

  const userMessage = `Focus du jour : ${plannerOutput.focus_areas.join(', ')}
Contexte : ${plannerOutput.context}

Données des matchs :
${enriched.join('\n\n')}`

  const { text, model_used } = await routeCompletion('analyst', systemPrompt, userMessage, 2048)
  const jsonStr = extractJson(text)

  try {
    const parsed = JSON.parse(jsonStr) as AnalystOutput
    // Validation stricte post-parsing
    const validPicks = parsed.picks_retenus.filter(p =>
      p.trend_pct >= MIN_TREND_PCT &&
      p.sample_size >= MIN_SAMPLE &&
      p.odds >= MIN_ODDS &&
      p.odds <= MAX_ODDS
    )
    return { ...parsed, picks_retenus: validPicks, model_used }
  } catch {
    return {
      picks_retenus: [],
      picks_rejetés: [],
      summary: "Erreur de parsing JSON dans la réponse de l'analyste.",
      model_used,
    }
  }
}
