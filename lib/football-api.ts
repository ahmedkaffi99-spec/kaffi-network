/**
 * Client pour football-data.org (gratuit — 10 req/min)
 * Récupère les matchs du jour et l'historique des équipes pour l'analyse de tendances.
 */

const BASE_URL = 'https://api.football-data.org/v4'

// Top 8 championnats européens + compétitions UEFA
const COMPETITIONS = ['PL', 'BL1', 'SA', 'PD', 'FL1', 'CL', 'EL', 'PPL', 'DED', 'BSA']

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function apiRequest<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY! },
    cache: 'no-store',
  })
  if (res.status === 429) {
    // Rate limit hit — wait 60s and retry once
    await sleep(60000)
    return apiRequest<T>(path)
  }
  if (!res.ok) {
    throw new Error(`Football API ${res.status}: ${await res.text()}`)
  }
  return res.json()
}

// ─── Types internes API ────────────────────────────────────────────────────

interface ApiTeam {
  id: number
  name: string
}

interface ApiScore {
  fullTime: { home: number | null; away: number | null }
}

interface ApiMatch {
  id: number
  utcDate: string
  status: string
  competition: { name: string; code: string }
  homeTeam: ApiTeam
  awayTeam: ApiTeam
  score: ApiScore
}

interface ApiMatchesResponse {
  matches: ApiMatch[]
}

// ─── Types exportés ────────────────────────────────────────────────────────

export interface TeamMatchResult {
  date: string
  opponent: string
  home: boolean
  goals_for: number
  goals_against: number
  total_goals: number
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

// ─── Fonctions publiques ───────────────────────────────────────────────────

export async function getTodayMatches(): Promise<TodayMatch[]> {
  const today = new Date().toISOString().split('T')[0]

  const data = await apiRequest<ApiMatchesResponse>(
    `/matches?dateFrom=${today}&dateTo=${today}&competitions=${COMPETITIONS.join(',')}`
  )

  return data.matches
    .filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED')
    .map(m => ({
      id: m.id,
      competition: m.competition.name,
      home_team: { id: m.homeTeam.id, name: m.homeTeam.name },
      away_team: { id: m.awayTeam.id, name: m.awayTeam.name },
      datetime: m.utcDate,
    }))
}

async function getTeamHistory(teamId: number, limit = 15): Promise<TeamMatchResult[]> {
  // 6.5s entre chaque requête pour rester sous 10 req/min
  await sleep(6500)

  const data = await apiRequest<ApiMatchesResponse>(
    `/teams/${teamId}/matches?status=FINISHED&limit=${limit}`
  )

  return data.matches
    .filter(m => m.score.fullTime.home !== null)
    .map(m => {
      const isHome = m.homeTeam.id === teamId
      const goalsFor = isHome ? m.score.fullTime.home! : m.score.fullTime.away!
      const goalsAgainst = isHome ? m.score.fullTime.away! : m.score.fullTime.home!
      return {
        date: m.utcDate,
        opponent: isHome ? m.awayTeam.name : m.homeTeam.name,
        home: isHome,
        goals_for: goalsFor,
        goals_against: goalsAgainst,
        total_goals: goalsFor + goalsAgainst,
      }
    })
}

export async function buildMatchAnalysisData(
  matches: TodayMatch[]
): Promise<MatchAnalysisData[]> {
  const cache = new Map<number, TeamMatchResult[]>()
  const result: MatchAnalysisData[] = []

  for (const match of matches) {
    if (!cache.has(match.home_team.id)) {
      cache.set(match.home_team.id, await getTeamHistory(match.home_team.id))
    }
    if (!cache.has(match.away_team.id)) {
      cache.set(match.away_team.id, await getTeamHistory(match.away_team.id))
    }

    result.push({
      match,
      home_team_last_matches: cache.get(match.home_team.id)!,
      away_team_last_matches: cache.get(match.away_team.id)!,
    })
  }

  return result
}
