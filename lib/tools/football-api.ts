const BASE_URL = 'https://api.football-data.org/v4'

// Top 8 championnats européens + C1 + EL
const COMPETITIONS = ['PL', 'BL1', 'SA', 'PD', 'FL1', 'CL', 'EL', 'PPL', 'DED', 'BSA']

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function apiRequest<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY! },
    cache: 'no-store',
  })
  if (res.status === 429) {
    await sleep(61000)
    return apiRequest<T>(path)
  }
  if (!res.ok) throw new Error(`FootballAPI ${res.status}: ${await res.text()}`)
  return res.json()
}

// ─── Types internes API ────────────────────────────────────────────────────────

interface ApiTeam { id: number; name: string; shortName?: string }
interface ApiScore { fullTime: { home: number | null; away: number | null } }
interface ApiMatch {
  id: number; utcDate: string; status: string
  competition: { name: string; code: string }
  homeTeam: ApiTeam; awayTeam: ApiTeam; score: ApiScore
}
interface ApiMatchesResponse { matches: ApiMatch[] }

// ─── Types exportés ───────────────────────────────────────────────────────────

export interface TeamMatchResult {
  date: string; opponent: string; home: boolean
  goals_for: number; goals_against: number; total_goals: number
  result: 'W' | 'D' | 'L'
}

export interface TodayMatch {
  id: number; competition: string
  home_team: { id: number; name: string }
  away_team: { id: number; name: string }
  datetime: string
}

export interface MatchAnalysisData {
  match: TodayMatch
  home_team_last_matches: TeamMatchResult[]
  away_team_last_matches: TeamMatchResult[]
}

// ─── Fonctions ────────────────────────────────────────────────────────────────

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
  await sleep(6500) // 10 req/min max
  const data = await apiRequest<ApiMatchesResponse>(
    `/teams/${teamId}/matches?status=FINISHED&limit=${limit}`
  )
  return data.matches
    .filter(m => m.score.fullTime.home !== null)
    .map(m => {
      const isHome = m.homeTeam.id === teamId
      const gf = isHome ? m.score.fullTime.home! : m.score.fullTime.away!
      const ga = isHome ? m.score.fullTime.away! : m.score.fullTime.home!
      const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
      return {
        date: m.utcDate,
        opponent: isHome ? m.awayTeam.name : m.homeTeam.name,
        home: isHome,
        goals_for: gf,
        goals_against: ga,
        total_goals: gf + ga,
        result,
      }
    })
}

export async function buildMatchAnalysisData(matches: TodayMatch[]): Promise<MatchAnalysisData[]> {
  const cache = new Map<number, TeamMatchResult[]>()
  const result: MatchAnalysisData[] = []
  for (const match of matches) {
    if (!cache.has(match.home_team.id))
      cache.set(match.home_team.id, await getTeamHistory(match.home_team.id))
    if (!cache.has(match.away_team.id))
      cache.set(match.away_team.id, await getTeamHistory(match.away_team.id))
    result.push({
      match,
      home_team_last_matches: cache.get(match.home_team.id)!,
      away_team_last_matches: cache.get(match.away_team.id)!,
    })
  }
  return result
}

// Pour result-checker : récupère le score final d'un match terminé
export async function getMatchResult(
  homeTeam: string, awayTeam: string, matchDate: string
): Promise<{ home: number; away: number } | null> {
  try {
    const data = await apiRequest<ApiMatchesResponse>(
      `/matches?dateFrom=${matchDate}&dateTo=${matchDate}`
    )
    const match = data.matches.find(
      m => m.homeTeam.name === homeTeam && m.awayTeam.name === awayTeam
        && m.status === 'FINISHED'
    )
    if (!match?.score.fullTime.home == null) return null
    return { home: match!.score.fullTime.home!, away: match!.score.fullTime.away! }
  } catch {
    return null
  }
}
