import { parseAgentJSON, callAgentModel, renderMission, loadMediumTermDigest } from '@/lib/agent-kernel'
import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { RunBudget, AgentMission } from '@/lib/agent-kernel/types'
import type { PlannerOutput, AnalystOutput } from '@/lib/types'
import { getTodayMatches, buildMatchAnalysisData, type TodayMatch, type MatchAnalysisData, type TeamMatchResult } from '@/lib/tools/football-api'
import { getTodayOdds, findMatchOdds, isKnownLeague, type MatchOdds } from '@/lib/tools/odds-api'
import { checkTeamNews } from '@/lib/tools/serper'

const MIN_TREND_PCT = 80
const MIN_SAMPLE = 8
const MIN_ODDS = 1.35
// Plafond volontairement large : la composition des 3 combinés (prudent/
// équilibré/audacieux) est décidée en aval par le Sélecteur de cotes
// (lib/agents/odds-selector.ts), qui a besoin d'assez de matière — surtout
// pour audacieux, sans plafond — plutôt que d'un plafond individuel bas ici.
const MAX_ODDS = 6.0
const MAX_PICKS = 20

const MISSION: AgentMission = {
  role: 'analyst',
  label: "l'Analyste",
  responsibility:
    'sélectionner les picks football à haute valeur statistique à partir des données fournies (API-Football, cotes, actualités), en respectant strictement les seuils de tendance et de cote.',
  doesNot: [
    'Ne planifie pas les compétitions/focus du jour — délégué au Planner.',
    'Ne valide pas la qualité finale du combiné — délégué au Superviseur.',
    "Ne rédige pas le post Telegram — délégué au Writer.",
    "N'invente jamais une statistique non présente dans les données fournies.",
  ],
}

function calcTrend(history: TeamMatchResult[], predicate: (m: TeamMatchResult) => boolean): { pct: number; count: number } {
  if (!history.length) return { pct: 0, count: 0 }
  const matching = history.filter(predicate).length
  return { pct: Math.round((matching / history.length) * 100), count: history.length }
}

// history est trié du plus récent au plus ancien (voir football-api.ts) —
// ces helpers de forme récente dépendent de cet ordre.
function winStreak(history: TeamMatchResult[]): number {
  let streak = 0
  for (const m of history) {
    if (m.result !== 'W') break
    streak++
  }
  return streak
}

function unbeatenStreak(history: TeamMatchResult[], n: number): boolean {
  const recent = history.slice(0, n)
  return recent.length === n && recent.every(m => m.result !== 'L')
}

function formPoints(history: TeamMatchResult[], n: number): { points: number; max: number } {
  const recent = history.slice(0, n)
  const points = recent.reduce((s, m) => s + (m.result === 'W' ? 3 : m.result === 'D' ? 1 : 0), 0)
  return { points, max: recent.length * 3 }
}

function avgGoals(history: TeamMatchResult[], n: number, key: 'goals_for' | 'goals_against'): number {
  const recent = history.slice(0, n)
  if (!recent.length) return 0
  return Math.round((recent.reduce((s, m) => s + m[key], 0) / recent.length) * 10) / 10
}

// Tendance over/under sur plusieurs lignes de but — les bookmakers ne
// proposent pas toujours 2.5, parfois seulement 1.5 ou 3.5 selon le match.
const GOAL_LINES = [1.5, 2.5, 3.5]
function goalLineTrends(history: TeamMatchResult[]): string {
  return GOAL_LINES.map(line => `over${line}=${calcTrend(history, m => m.total_goals > line).pct}%`).join(', ')
}

function oddsLines(matchOdds: MatchOdds): string[] {
  const lines: string[] = []
  const { home, draw, away } = matchOdds.h2h
  if (home != null && home >= MIN_ODDS && home <= MAX_ODDS) lines.push(`Victoire domicile: ${home.toFixed(2)}`)
  if (draw != null && draw >= MIN_ODDS && draw <= MAX_ODDS) lines.push(`Match nul: ${draw.toFixed(2)}`)
  if (away != null && away >= MIN_ODDS && away <= MAX_ODDS) lines.push(`Victoire extérieur: ${away.toFixed(2)}`)
  for (const { point, over, under } of matchOdds.totals) {
    if (over != null && over >= MIN_ODDS && over <= MAX_ODDS) lines.push(`Plus de ${point}: ${over.toFixed(2)}`)
    if (under != null && under >= MIN_ODDS && under <= MAX_ODDS) lines.push(`Moins de ${point}: ${under.toFixed(2)}`)
  }
  const { yes, no } = matchOdds.btts
  if (yes != null && yes >= MIN_ODDS && yes <= MAX_ODDS) lines.push(`BTTS Oui: ${yes.toFixed(2)}`)
  if (no != null && no >= MIN_ODDS && no <= MAX_ODDS) lines.push(`BTTS Non: ${no.toFixed(2)}`)
  const { home_point, home_price, away_point, away_price } = matchOdds.spreads
  if (home_point != null && home_price != null && home_price >= MIN_ODDS && home_price <= MAX_ODDS) {
    lines.push(`Handicap ${matchOdds.home_team} ${home_point >= 0 ? '+' : ''}${home_point}: ${home_price.toFixed(2)}`)
  }
  if (away_point != null && away_price != null && away_price >= MIN_ODDS && away_price <= MAX_ODDS) {
    lines.push(`Handicap ${matchOdds.away_team} ${away_point >= 0 ? '+' : ''}${away_point}: ${away_price.toFixed(2)}`)
  }
  return lines
}

export interface AnalystContext {
  enriched: string[]
  oddsOnlyMode: boolean
  memoryContext: string
  // Nom d'équipe (normalisé) → URL de logo réelle — fourni par API-Football,
  // jamais par le LLM (qui ne doit jamais inventer une URL). Vide en mode
  // cotes seules (l'API de cotes ne fournit aucun logo).
  teamLogos: Map<string, string>
}

/**
 * Phase de PERCEPTION — tous les appels d'outils coûteux (API-Football
 * rate-limitée à 7s/appel, cotes, actualités). Exécutée UNE SEULE FOIS par
 * run et réutilisée à chaque itération de raisonnement : avant cette
 * séparation, une révision demandée par le Superviseur relançait tout ce
 * scan (jusqu'à ~2min de sleeps rate-limit en plus par itération), ce qui
 * interdisait d'augmenter le budget d'itérations sans risquer le timeout
 * Vercel (300s).
 */
export async function gatherAnalystContext(
  plannerOutput: PlannerOutput,
  blackboard: Blackboard
): Promise<AnalystContext> {
  const [odds, memoryContext] = await Promise.all([getTodayOdds(), loadMediumTermDigest()])

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

  if (analysisData.length === 0) {
    oddsOnlyMode = true
  }

  const enriched: string[] = []
  const teamLogos = new Map<string, string>()

  if (!oddsOnlyMode) {
    for (const { match } of analysisData) {
      teamLogos.set(match.home_team.name.trim().toLowerCase(), match.home_team.logo)
      teamLogos.set(match.away_team.name.trim().toLowerCase(), match.away_team.logo)
    }

    for (const { match, home_team_last_matches, away_team_last_matches } of analysisData) {
      const matchOdds = findMatchOdds(odds, match.home_team.name, match.away_team.name)
      if (!matchOdds) continue

      const homeH = home_team_last_matches
      const awayH = away_team_last_matches

      const awayBtts = calcTrend(awayH, m => m.goals_for > 0 && m.goals_against > 0)
      const homeBtts = calcTrend(homeH, m => m.goals_for > 0 && m.goals_against > 0)
      const homeWins = calcTrend(homeH, m => m.result === 'W' && m.home)
      // Nouveaux types de pari publiables (cotes déjà récupérées via
      // oddsLines — "Victoire extérieur" et "Match nul" — mais jamais
      // proposés faute de tendance calculée jusqu'ici).
      const awayWins = calcTrend(awayH, m => m.result === 'W' && !m.home)
      const homeDraws = calcTrend(homeH, m => m.result === 'D')
      const awayDraws = calcTrend(awayH, m => m.result === 'D')
      // Tendances de contexte — renforcent le raisonnement, pas de nouveau
      // type de pari (pas de cote bookmaker dédiée disponible pour celles-ci).
      const homeCleanSheet = calcTrend(homeH, m => m.goals_against === 0)
      const awayCleanSheet = calcTrend(awayH, m => m.goals_against === 0)
      const homeBigWin = calcTrend(homeH, m => m.result === 'W' && m.goals_for - m.goals_against >= 2)
      const homeForm5 = formPoints(homeH, 5)
      const awayForm5 = formPoints(awayH, 5)

      const lines = oddsLines(matchOdds)
      if (!lines.length) continue

      const [homeNews, awayNews] = await Promise.all([
        checkTeamNews(match.home_team.name),
        checkTeamNews(match.away_team.name),
      ])

      enriched.push(`MATCH: ${match.home_team.name} vs ${match.away_team.name} (${match.competition}) — ${match.datetime}
Domicile ${match.home_team.name} (${homeH.length} matchs): ${goalLineTrends(homeH)}, btts=${homeBtts.pct}%, wins_home=${homeWins.pct}%, nul=${homeDraws.pct}%, cage_inviolee=${homeCleanSheet.pct}%, victoire_large(2+ buts)=${homeBigWin.pct}%
Extérieur ${match.away_team.name} (${awayH.length} matchs): ${goalLineTrends(awayH)}, btts=${awayBtts.pct}%, wins_ext=${awayWins.pct}%, nul=${awayDraws.pct}%, cage_inviolee=${awayCleanSheet.pct}%
Forme récente ${match.home_team.name} (5 derniers): ${homeForm5.points}/${homeForm5.max} pts, ${avgGoals(homeH, 5, 'goals_for')} buts marqués/match, ${avgGoals(homeH, 5, 'goals_against')} encaissés/match, série de victoires en cours=${winStreak(homeH)}, invaincu sur 5=${unbeatenStreak(homeH, 5) ? 'oui' : 'non'}
Forme récente ${match.away_team.name} (5 derniers): ${awayForm5.points}/${awayForm5.max} pts, ${avgGoals(awayH, 5, 'goals_for')} buts marqués/match, ${avgGoals(awayH, 5, 'goals_against')} encaissés/match, série de victoires en cours=${winStreak(awayH)}, invaincu sur 5=${unbeatenStreak(awayH, 5) ? 'oui' : 'non'}
Actualités ${match.home_team.name}: ${homeNews}
Actualités ${match.away_team.name}: ${awayNews}
Cotes disponibles (${MIN_ODDS}–${MAX_ODDS}): ${lines.join(', ')}`)
    }
  } else {
    // Sans API-Football pour recadrer la sélection, on se limite aux
    // championnats reconnaissables — sinon les 20 premiers événements
    // renvoyés par l'API de cotes (qui interroge tout le foot mondial)
    // peuvent inclure des ligues obscures que les abonnés ne connaissent pas.
    const knownLeagueOdds = odds.filter(o => isKnownLeague(o.sport_key))

    for (const event of knownLeagueOdds.slice(0, 20)) {
      const lines = oddsLines(event)
      if (!lines.length) continue

      const [homeNews, awayNews] = await Promise.all([
        checkTeamNews(event.home_team),
        checkTeamNews(event.away_team),
      ])

      const impliedProbs = lines.map(l => {
        const oddsVal = parseFloat(l.split(': ')[1])
        return `${l} (prob. implicite: ${Math.round((1 / oddsVal) * 100)}%)`
      })

      enriched.push(`MATCH: ${event.home_team} vs ${event.away_team} — ${event.commence_time}
[MODE COTES UNIQUEMENT — données historiques indisponibles]
Actualités ${event.home_team}: ${homeNews}
Actualités ${event.away_team}: ${awayNews}
Cotes disponibles (${MIN_ODDS}–${MAX_ODDS}) avec probabilité implicite : ${impliedProbs.join(', ')}`)
    }
  }

  blackboard.post({
    from: 'analyst',
    type: 'observation',
    content: `${enriched.length} matchs analysés (mode ${oddsOnlyMode ? 'cotes seules' : 'complet'}).`,
  })

  return { enriched, oddsOnlyMode, memoryContext, teamLogos }
}

/**
 * Phase de RAISONNEMENT — un appel modèle par itération, réutilisant le
 * contexte déjà perçu. C'est ici que se joue plan → décision : le prompt
 * demande explicitement au modèle d'exposer sa stratégie (`plan`) avant sa
 * sélection finale, dans le même appel (pas d'aller-retour supplémentaire).
 */
export async function reasonAnalystPicks(
  plannerOutput: PlannerOutput,
  context: AnalystContext,
  supervisorFeedback: string | undefined,
  blackboard: Blackboard,
  budget: RunBudget
): Promise<AnalystOutput> {
  const { enriched, oddsOnlyMode, memoryContext, teamLogos } = context

  if (!enriched.length) {
    return {
      picks_retenus: [],
      picks_rejetés: [],
      summary: "Aucun match éligible trouvé pour aujourd'hui.",
      model_used: 'none',
    }
  }

  const mission = renderMission(MISSION)
  const longTermMemory = blackboard.read<string>('longTermMemory') ?? 'Aucune leçon long terme enregistrée.'

  const systemPrompt = oddsOnlyMode
    ? `${mission}

MÉMOIRE LONG TERME (leçons des runs précédents) :
${longTermMemory}

Les données historiques API-Football sont temporairement indisponibles.
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
  "plan": "string (stratégie suivie pour cette sélection, 1 phrase)",
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
    : `${mission}

SOURCES DE DONNÉES :
- API-Football (champs Domicile/Extérieur avec %) : SEULE source pour les statistiques chiffrées.
- Serper (champ Actualités) : contexte QUALITATIF uniquement — blessures, suspensions. Jamais de stat.

TYPES DE PARI DISPONIBLES (avec cote réelle) : Victoire domicile, Victoire extérieur, Match nul, Plus de/Moins de (ligne de buts — 1.5, 2.5 ou 3.5 selon ce qui est réellement proposé dans les cotes disponibles ci-dessous, jamais supposer que 2.5 est la seule ligne), Handicap — choisis celui dont la tendance chiffrée est la plus solide pour CE match, pas toujours le même type par réflexe.
- Plus de/Moins de : reprends EXACTEMENT la ligne présente dans les cotes disponibles (ex: si seule "Plus de 1.5" apparaît, ne propose jamais "Plus de 2.5"). Justifie-le avec la tendance overX.X correspondant à la même ligne.
- Handicap : reprends EXACTEMENT le libellé et la valeur de la ligne fournie dans les cotes disponibles (ex: "Handicap Real Madrid -1.5"), n'invente jamais une ligne absente des données. Justifie-le avec victoire_large (une équipe qui gagne souvent avec 2 buts d'écart ou plus est solide sur un handicap -1.5).
TENDANCES DE CONTEXTE (jamais un type de pari en soi, mais renforcent ou affaiblissent ta confiance) : nul, cage_inviolee, victoire_large, forme récente (points/5, buts marqués/encaissés par match, série de victoires, invaincu sur 5) — utilise-les pour départager deux picks proches en tendance principale, jamais pour justifier un pick qui ne respecte pas la règle 1 ci-dessous.

RÈGLES ABSOLUES :
1. Tendance ≥ ${MIN_TREND_PCT}% sur ≥ ${MIN_SAMPLE} matchs (API-Football uniquement) — s'applique au type de pari choisi (ex: wins_ext pour "Victoire extérieur", nul pour "Match nul", victoire_large pour "Handicap"), pas à une tendance de contexte
2. Cote entre ${MIN_ODDS} et ${MAX_ODDS}
3. Maximum ${MAX_PICKS} picks
4. Blessure/suspension clé détectée = pick rejeté

MÉMOIRE MOYEN TERME (30 derniers jours) : ${memoryContext || 'Aucun historique.'}
MÉMOIRE LONG TERME (leçons des runs précédents) : ${longTermMemory}
${supervisorFeedback ? `\nFEEDBACK SUPERVISEUR :\n${supervisorFeedback}` : ''}

Réponds UNIQUEMENT JSON :
{
  "plan": "string (stratégie suivie pour cette sélection, 1 phrase)",
  "picks_retenus": [
    { "competition": "string", "home_team": "string", "away_team": "string", "match_datetime": "ISO 8601",
      "bet_type": "string", "odds": number, "trend_label": "string", "trend_pct": number, "sample_size": number }
  ],
  "picks_rejetés": [{ "match": "string", "competition": "string", "bet_type": "string", "raison": "string" }],
  "summary": "string"
}`

  const userMessage = `Focus du jour : ${plannerOutput.focus_areas.join(', ')}
Contexte : ${plannerOutput.context}
${plannerOutput.trending_matches.length ? `Affiches identifiées par recherche web comme notables aujourd'hui (priorise-les si elles apparaissent dans les données ci-dessous, sans jamais assouplir les seuils pour les inclure) : ${plannerOutput.trending_matches.join(', ')}` : ''}

Données des matchs :
${enriched.join('\n\n')}`

  const { text, model_used } = await callAgentModel('analyst', systemPrompt, userMessage, 4096, blackboard, budget)

  const fallback: AnalystOutput = {
    picks_retenus: [],
    picks_rejetés: [],
    summary: "Erreur de parsing JSON dans la réponse de l'analyste.",
    model_used,
  }
  const parsed = parseAgentJSON<AnalystOutput>(text, fallback)

  const validPicks = oddsOnlyMode
    ? parsed.picks_retenus.filter(p => p.odds >= MIN_ODDS && p.odds <= MAX_ODDS)
    : parsed.picks_retenus.filter(
        p => p.trend_pct >= MIN_TREND_PCT && p.sample_size >= MIN_SAMPLE && p.odds >= MIN_ODDS && p.odds <= MAX_ODDS
      )

  // Logo attaché par lookup sur les données API-Football déjà collectées —
  // jamais généré par le LLM, qui ne connaît aucune URL de logo réelle.
  const picksWithLogos = validPicks.map(p => ({
    ...p,
    home_team_logo: teamLogos.get(p.home_team.trim().toLowerCase()) ?? null,
    away_team_logo: teamLogos.get(p.away_team.trim().toLowerCase()) ?? null,
  }))

  return { ...parsed, picks_retenus: picksWithLogos, model_used }
}
