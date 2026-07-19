import { getRemainingQuota, incrementQuota } from '@/lib/tools/quota-tracker'

const BASE_URL = 'https://v3.football.api-sports.io'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function apiRequest<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY! },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`API-Football ${res.status}: ${await res.text()}`)
  const json = await res.json()
  // L'API renvoie toujours { response: [...], errors: {...} }
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football error: ${JSON.stringify(json.errors)}`)
  }
  return json as T
}

// ─── Types internes API-Football v3 ──────────────────────────────────────────

interface ApiFixtureStatus { short: string }
interface ApiFixtureInfo { id: number; date: string; status: ApiFixtureStatus }
interface ApiTeamInfo { id: number; name: string }
interface ApiTeams { home: ApiTeamInfo; away: ApiTeamInfo }
interface ApiGoals { home: number | null; away: number | null }
interface ApiLeague { name: string }
interface ApiFixtureEntry {
  fixture: ApiFixtureInfo
  teams: ApiTeams
  goals: ApiGoals
  league: ApiLeague
}
interface ApiFixturesResponse { response: ApiFixtureEntry[] }

// ─── Types exportés ───────────────────────────────────────────────────────────

export interface TeamMatchResult {
  date: string
  opponent: string
  home: boolean
  goals_for: number
  goals_against: number
  total_goals: number
  result: 'W' | 'D' | 'L'
}

export interface TodayMatch {
  id: number
  competition: string
  home_team: { id: number; name: string }
  away_team: { id: number; name: string }
  datetime: string
}

export interface MatchAnalysisData {
  match: TodayMatch
  home_team_last_matches: TeamMatchResult[]
  away_team_last_matches: TeamMatchResult[]
}

// ─── Constantes de statut ─────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['NS', 'TBD', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'INT', 'LIVE']
const FINISHED_STATUSES = ['FT', 'AET', 'PEN']

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compte une requête dans le quota et retourne le résultat de la requête. */
async function trackRequest<T>(path: string, n = 1): Promise<T> {
  const data = await apiRequest<T>(path)
  await incrementQuota('api-football', n)
  return data
}

function mapFixtureToTodayMatch(entry: ApiFixtureEntry): TodayMatch {
  return {
    id: entry.fixture.id,
    competition: entry.league.name,
    home_team: { id: entry.teams.home.id, name: entry.teams.home.name },
    away_team: { id: entry.teams.away.id, name: entry.teams.away.name },
    datetime: entry.fixture.date,
  }
}

function mapFixtureToTeamMatchResult(entry: ApiFixtureEntry, teamId: number): TeamMatchResult {
  const isHome = entry.teams.home.id === teamId
  const gf = (isHome ? entry.goals.home : entry.goals.away) ?? 0
  const ga = (isHome ? entry.goals.away : entry.goals.home) ?? 0
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
  return {
    date: entry.fixture.date,
    opponent: isHome ? entry.teams.away.name : entry.teams.home.name,
    home: isHome,
    goals_for: gf,
    goals_against: ga,
    total_goals: gf + ga,
    result,
  }
}

// ─── Fonctions exportées ──────────────────────────────────────────────────────

/**
 * Récupère tous les matchs du jour (statut actif ou à venir).
 * Coût : 1 requête API.
 */
export async function getTodayMatches(): Promise<TodayMatch[]> {
  const today = new Date().toISOString().split('T')[0]
  const data = await trackRequest<ApiFixturesResponse>(`/fixtures?date=${today}`, 1)
  return data.response
    .filter(entry => ACTIVE_STATUSES.includes(entry.fixture.status.short))
    .map(mapFixtureToTodayMatch)
}

// Plan gratuit API-Football : saisons disponibles 2022-2024, pas de paramètre `last`
// Rate limit : 10 requêtes/minute → sleep 7s entre les appels d'historique
const RATE_LIMIT_SLEEP = 7000
const AVAILABLE_SEASONS = [2024, 2023, 2022]

/**
 * Récupère l'historique des derniers matchs d'une équipe.
 * Utilise season=2024 → 2023 → 2022 jusqu'à obtenir ≥8 matchs terminés.
 * Coût : 1 à 3 requêtes API selon les données disponibles.
 */
async function getTeamHistory(teamId: number, limit = 15): Promise<TeamMatchResult[]> {
  let finished: ApiFixtureEntry[] = []

  for (const season of AVAILABLE_SEASONS) {
    await sleep(RATE_LIMIT_SLEEP)
    const data = await trackRequest<ApiFixturesResponse>(
      `/fixtures?team=${teamId}&season=${season}`,
      1
    )
    const seasonFinished = data.response.filter(e => FINISHED_STATUSES.includes(e.fixture.status.short))
    finished = [...finished, ...seasonFinished]
    if (finished.length >= 8) break
  }

  return finished
    .sort((a, b) => b.fixture.date.localeCompare(a.fixture.date))
    .slice(0, limit)
    .map(e => mapFixtureToTeamMatchResult(e, teamId))
}

/**
 * Construit les données d'analyse pour chaque match en récupérant l'historique
 * des deux équipes, avec gestion du quota et cache en mémoire.
 *
 * Coût par match : 0, 1 ou 2 requêtes selon le cache (chaque équipe inédite = 1 req).
 * Marge de sécurité : 5 requêtes réservées avant la boucle.
 */
// Limite le nombre de matchs pour rester dans le timeout Vercel (300s)
// Rate limit 10 req/min (7s/call) × 3 saisons worst-case × 2 équipes × N matchs + AI
// → MAX 8 matchs analysés par run = ~168s d'appels API + ~120s IA = ~288s
const MAX_MATCHES_TO_ANALYZE = 8

export async function buildMatchAnalysisData(
  matches: TodayMatch[],
  historyLimit = 15
): Promise<MatchAnalysisData[]> {
  const cache = new Map<number, TeamMatchResult[]>()
  const result: MatchAnalysisData[] = []

  const SAFETY_MARGIN = 5
  // Worst-case : 3 appels par équipe (3 saisons disponibles)
  const COST_PER_TEAM = 3
  let remaining = await getRemainingQuota('api-football')

  const limited = matches.slice(0, MAX_MATCHES_TO_ANALYZE)

  for (const match of limited) {
    const homeInCache = cache.has(match.home_team.id)
    const awayInCache = cache.has(match.away_team.id)
    const cost = (homeInCache ? 0 : COST_PER_TEAM) + (awayInCache ? 0 : COST_PER_TEAM)

    if (remaining - cost < SAFETY_MARGIN) {
      console.warn(
        `[quota] Quota insuffisant (restant: ${remaining}, coût: ${cost}) — arrêt après ${result.length} matchs.`
      )
      break
    }

    if (!homeInCache) {
      const hist = await getTeamHistory(match.home_team.id, historyLimit)
      cache.set(match.home_team.id, hist)
      remaining -= COST_PER_TEAM
    }

    if (!awayInCache) {
      const hist = await getTeamHistory(match.away_team.id, historyLimit)
      cache.set(match.away_team.id, hist)
      remaining -= COST_PER_TEAM
    }

    result.push({
      match,
      home_team_last_matches: cache.get(match.home_team.id)!,
      away_team_last_matches: cache.get(match.away_team.id)!,
    })
  }

  return result
}

/**
 * Récupère le score final d'un match terminé identifié par les noms des équipes
 * et la date du match.
 * Coût : 1 requête API.
 */
export async function getMatchResult(
  homeTeam: string,
  awayTeam: string,
  matchDate: string
): Promise<{ home: number; away: number } | null> {
  try {
    const data = await trackRequest<ApiFixturesResponse>(`/fixtures?date=${matchDate}`, 1)
    const entry = data.response.find(
      e =>
        e.teams.home.name === homeTeam &&
        e.teams.away.name === awayTeam &&
        FINISHED_STATUSES.includes(e.fixture.status.short)
    )
    if (!entry || entry.goals.home === null || entry.goals.away === null) return null
    return { home: entry.goals.home, away: entry.goals.away }
  } catch {
    return null
  }
}
