import { routeCompletion } from '@/lib/model-router'
import type { PlannerOutput, AnalystOutput } from '@/lib/types'
import { getTodayMatches, buildMatchAnalysisData, type TodayMatch, type MatchAnalysisData, type TeamMatchResult } from '@/lib/tools/football-api'
import { getTodayOdds, findMatchOdds, type MatchOdds } from '@/lib/tools/odds-api'
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
  const fenceMatch = text.match(/```json?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  const braceStart = text.indexOf('{')
  const braceEnd = text.lastIndexOf('}')
  if (braceStart !== -1 && braceEnd > braceStart) return text.slice(braceStart, braceEnd + 1)
  return text.trim()
}

function oddsLines(matchOdds: MatchOdds): string[] {
  const lines: string[] = []
  const { home, draw, away } = matchOdds.h2h
  if (home != null && home >= MIN_ODDS && home <= MAX_ODDS) lines.push(`Victoire domicile: ${home.toFixed(2)}`)
  if (draw != null && draw >= MIN_ODDS && draw <= MAX_ODDS) lines.push(`Match nul: ${draw.toFixed(2)}`)
  if (away != null && away >= MIN_ODDS && away <= MAX_ODDS) lines.push(`Victoire extérieur: ${away.toFixed(2)}`)
  const { over_2_5, under_2_5 } = matchOdds.totals
  if (over_2_5 != null && over_2_5 >= MIN_ODDS && over_2_5 <= MAX_ODDS) lines.push(`Plus de 2.5: ${over_2_5.toFixed(2)}`)
  if (under_2_5 != null && under_2_5 >= MIN_ODDS && under_2_5 <= MAX_ODDS) lines.push(`Moins de 2.5: ${under_2_5.toFixed(2)}`)
  const { yes, no } = matchOdds.btts
  if (yes != null && yes >= MIN_ODDS && yes <= MAX_ODDS) lines.push(`BTTS Oui: ${yes.toFixed(2)}`)
  if (no != null && no >= MIN_ODDS && no <= MAX_ODDS) lines.push(`BTTS Non: ${no.toFixed(2)}`)
  return lines
}

export async function runAnalyst(
  plannerOutput: PlannerOutput,
  supervisorFeedback?: string
): Promise<AnalystOutput> {
  // Récupère odds et perf en parallèle — ces appels ne dépendent pas d'API-Football
  const [odds, performance] = await Promise.all([getTodayOdds(), getAllPerformance()])
  const memoryContext = formatMemoryContext(performance)

  // Tente de récupérer les matchs et l'historique via API-Football
  let analysisData: MatchAnalysisData[] = []
  let oddsOnlyMode = false

  try {
    const matches: TodayMatch[] = await getTodayMatches()
    if (matches.length > 0) {
      analysisData = await buildMatchAnalysisData(matches)
    }
  } catch (err) {
    console.warn('[analyst] API-Football indisponible (quota ou erreur) — mode cotes uniquement:', err)
    oddsOnlyMode = true
  }

  // Fallback : si pas de données API-Football, utilise les matchs de The Odds API directement
  if (analysisData.length === 0) {
    oddsOnlyMode = true
  }

  const enriched: string[] = []

  if (!oddsOnlyMode) {
    // ── Mode complet : stats API-Football + cotes ─────────────────────────────
    for (const { match, home_team_last_matches, away_team_last_matches } of analysisData) {
      const matchOdds = findMatchOdds(odds, match.home_team.name, match.away_team.name)
      if (!matchOdds) continue

      const homeH = home_team_last_matches
      const awayH = away_team_last_matches

      const homeOver25  = calcTrend(homeH, m => m.total_goals > 2.5)
      const awayOver25  = calcTrend(awayH, m => m.total_goals > 2.5)
      const homeUnder25 = calcTrend(homeH, m => m.total_goals < 2.5)
      const awayUnder25 = calcTrend(awayH, m => m.total_goals < 2.5)
      const homeBtts    = calcTrend(homeH, m => m.goals_for > 0 && m.goals_against > 0)
      const awayBtts    = calcTrend(awayH, m => m.goals_for > 0 && m.goals_against > 0)
      const homeWins    = calcTrend(homeH, m => m.result === 'W' && m.home)

      const lines = oddsLines(matchOdds)
      if (!lines.length) continue

      // Serper = contexte qualitatif UNIQUEMENT (blessures, suspensions, forfaits)
      const [homeNews, awayNews] = await Promise.all([
        checkTeamNews(match.home_team.name),
        checkTeamNews(match.away_team.name),
      ])

      enriched.push(`MATCH: ${match.home_team.name} vs ${match.away_team.name} (${match.competition}) — ${match.datetime}
Domicile ${match.home_team.name} (${homeH.length} matchs): over2.5=${homeOver25.pct}%, under2.5=${homeUnder25.pct}%, btts=${homeBtts.pct}%, wins_home=${homeWins.pct}%
Extérieur ${match.away_team.name} (${awayH.length} matchs): over2.5=${awayOver25.pct}%, under2.5=${awayUnder25.pct}%, btts=${awayBtts.pct}%
Actualités ${match.home_team.name}: ${homeNews}
Actualités ${match.away_team.name}: ${awayNews}
Cotes disponibles (${MIN_ODDS}–${MAX_ODDS}): ${lines.join(', ')}`)
    }
  } else {
    // ── Mode fallback cotes uniquement (API-Football quota épuisé) ────────────
    // The Odds API reste disponible — on utilise ses matchs + la probabilité implicite des cotes
    for (const event of odds.slice(0, 20)) {
      const lines = oddsLines(event)
      if (!lines.length) continue

      const [homeNews, awayNews] = await Promise.all([
        checkTeamNews(event.home_team),
        checkTeamNews(event.away_team),
      ])

      // Probabilité implicite = 1/cote × 100, arrondie à l'entier
      const impliedProbs = lines.map(l => {
        const odds = parseFloat(l.split(': ')[1])
        return `${l} (prob. implicite: ${Math.round((1 / odds) * 100)}%)`
      })

      enriched.push(`MATCH: ${event.home_team} vs ${event.away_team} — ${event.commence_time}
[MODE COTES UNIQUEMENT — données historiques indisponibles]
Actualités ${event.home_team}: ${homeNews}
Actualités ${event.away_team}: ${awayNews}
Cotes disponibles (${MIN_ODDS}–${MAX_ODDS}) avec probabilité implicite : ${impliedProbs.join(', ')}`)
    }
  }

  if (!enriched.length) {
    return {
      picks_retenus: [],
      picks_rejetés: [],
      summary: "Aucun match éligible trouvé pour aujourd'hui.",
      model_used: 'none',
    }
  }

  const systemPrompt = oddsOnlyMode
    ? `Tu es l'analyste expert de Kaffi Network. Les données historiques API-Football sont temporairement indisponibles.
Tu travailles en MODE COTES UNIQUEMENT : les cotes de marché (bookmakers agrégés) sont ta seule source quantitative.

RÈGLES EN MODE COTES :
- Les cotes reflètent la probabilité implicite calculée sur des milliers de matchs. Une cote < 1.60 = probabilité > 62% selon le marché.
- Source statistique autorisée : cotes uniquement. Jamais de chiffre inventé ou issu des actualités Serper.
- Actualités Serper : contexte qualitatif UNIQUEMENT (blessures, suspensions). Aucune stat.
- Retiens ${MAX_PICKS} picks maximum avec les cotes les plus basses (consensus marché le plus fort).
- trend_pct = probabilité implicite déjà calculée et fournie dans les données (ex: 65)
- sample_size = 0 OBLIGATOIRE (pas de données historiques)

${supervisorFeedback ? `FEEDBACK SUPERVISEUR :\n${supervisorFeedback}\n` : ''}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "picks_retenus": [
    {
      "competition": "string",
      "home_team": "string",
      "away_team": "string",
      "match_datetime": "ISO 8601",
      "bet_type": "string",
      "odds": number,
      "trend_label": "string (ex: Cote marché 1.55 = 65% probabilité implicite)",
      "trend_pct": number,
      "sample_size": 0
    }
  ],
  "picks_rejetés": [{ "match": "string", "competition": "string", "bet_type": "string", "raison": "string" }],
  "summary": "string"
}`
    : `Tu es l'analyste expert de Kaffi Network. Tu sélectionnes des picks football à haute valeur statistique.

SOURCES DE DONNÉES :
- API-Football (champs Domicile/Extérieur avec %) : SEULE source pour les statistiques chiffrées.
- Serper (champ Actualités) : contexte QUALITATIF uniquement — blessures, suspensions. Jamais de stat.

RÈGLES ABSOLUES :
1. Tendance ≥ ${MIN_TREND_PCT}% sur ≥ ${MIN_SAMPLE} matchs (API-Football uniquement)
2. Cote entre ${MIN_ODDS} et ${MAX_ODDS}
3. Maximum ${MAX_PICKS} picks
4. Blessure/suspension clé détectée = pick rejeté

MÉMOIRE : ${memoryContext || 'Aucun historique.'}
${supervisorFeedback ? `\nFEEDBACK SUPERVISEUR :\n${supervisorFeedback}` : ''}

Réponds UNIQUEMENT JSON :
{
  "picks_retenus": [
    { "competition": "string", "home_team": "string", "away_team": "string", "match_datetime": "ISO 8601",
      "bet_type": "string", "odds": number, "trend_label": "string", "trend_pct": number, "sample_size": number }
  ],
  "picks_rejetés": [{ "match": "string", "competition": "string", "bet_type": "string", "raison": "string" }],
  "summary": "string"
}`

  const userMessage = `Focus du jour : ${plannerOutput.focus_areas.join(', ')}
Contexte : ${plannerOutput.context}

Données des matchs :
${enriched.join('\n\n')}`

  const { text, model_used } = await routeCompletion('analyst', systemPrompt, userMessage, 2048)
  const jsonStr = extractJson(text)

  try {
    const parsed = JSON.parse(jsonStr) as AnalystOutput

    const validPicks = oddsOnlyMode
      ? parsed.picks_retenus.filter(p => p.odds >= MIN_ODDS && p.odds <= MAX_ODDS)
      : parsed.picks_retenus.filter(p =>
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
