import { getRemainingQuota, incrementQuota } from '@/lib/tools/quota-tracker'

const BASE_URL = 'https://v3.football.api-sports.io'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function apiRequest<T>(path: string): Promise<T> {
  const apiKey = process.env.API_FOOTBALL_KEY

  if (!apiKey) {
    throw new Error("Configuration requise : La clé API_FOOTBALL_KEY est introuvable dans l'environnement.")
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'x-apisports-key': apiKey,
      'Content-Type': 'application/json'
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`API-Football HTTP Error ${res.status}: ${await res.text()}`)
  }

  const json = await res.json()

  if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football API Error: ${JSON.stringify(json.errors)}`)
  }

  return json as T
}

// ─── Types internes API-Football v3 ──────────────────────────────────────────

interface ApiFixtureStatus { short: string }
interface ApiFixtureInfo { id: number; date: string; status: ApiFixtureStatus }
interface ApiTeamInfo { id: number; name: string; logo: string }
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
  home_team: { id: number; name: string; logo: string }
  away_team: { id: number; name: string; logo: string }
  datetime: string
}

export interface MatchAnalysisData {
  match: TodayMatch
  home_team_last_matches: TeamMatchResult[]
  away_team_last_matches: TeamMatchResult[]
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['NS', 'TBD', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'INT', 'LIVE']
const FINISHED_STATUSES = ['FT', 'AET', 'PEN']
// Plan gratuit : rate limit 10 req/min → 1 requête toutes les 6s minimum
const RATE_LIMIT_SLEEP = 7000
// Rate limit 7s/call × 2 équipes × 8 matchs + IA ≈ 288s < 300s timeout Vercel
const MAX_MATCHES_TO_ANALYZE = 8

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function trackRequest<T>(path: string, n = 1): Promise<T> {
  const data = await apiRequest<T>(path)
  await incrementQuota('api-football', n)
  return data
}

function mapFixtureToTodayMatch(entry: ApiFixtureEntry): TodayMatch {
  return {
    id: entry.fixture.id,
    competition: entry.league.name,
    home_team: { id: entry.teams.home.id, name: entry.teams.home.name, logo: entry.teams.home.logo },
    away_team: { id: entry.teams.away.id, name: entry.teams.away.name, logo: entry.teams.away.logo },
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

export async function getTodayMatches(): Promise<TodayMatch[]> {
  const today = new Date().toISOString().split('T')[0]
  const data = await trackRequest<ApiFixturesResponse>(`/fixtures?date=${today}`, 1)

  return data.response
    .filter(entry => ACTIVE_STATUSES.includes(entry.fixture.status.short))
    .map(mapFixtureToTodayMatch)
}

async function getTeamHistory(teamId: number, limit = 15): Promise<TeamMatchResult[]> {
  await sleep(RATE_LIMIT_SLEEP)
  const data = await trackRequest<ApiFixturesResponse>(
    `/fixtures?team=${teamId}&season=2024`,
    1
  )

  const finished = data.response.filter(e => FINISHED_STATUSES.includes(e.fixture.status.short))

  return finished
    .sort((a, b) => b.fixture.date.localeCompare(a.fixture.date))
    .slice(0, limit)
    .map(e => mapFixtureToTeamMatchResult(e, teamId))
}

export async function buildMatchAnalysisData(
  matches: TodayMatch[],
  historyLimit = 15
): Promise<MatchAnalysisData[]> {
  const cache = new Map<number, TeamMatchResult[]>()
  const result: MatchAnalysisData[] = []
  const SAFETY_MARGIN = 5
  const COST_PER_TEAM = 1

  let remaining = await getRemainingQuota('api-football')
  const limited = matches.slice(0, MAX_MATCHES_TO_ANALYZE)

  for (const match of limited) {
    const homeInCache = cache.has(match.home_team.id)
    const awayInCache = cache.has(match.away_team.id)
    const cost = (homeInCache ? 0 : COST_PER_TEAM) + (awayInCache ? 0 : COST_PER_TEAM)

    if (remaining - cost < SAFETY_MARGIN) {
      console.warn(`[quota] Quota insuffisant (restant: ${remaining}, coût: ${cost}) — arrêt après ${result.length} matchs.`)
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
