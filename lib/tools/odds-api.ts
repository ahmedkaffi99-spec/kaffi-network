const BASE_URL = 'https://api.the-odds-api.com/v4'
const SPORT = 'soccer'

interface OddsOutcome { name: string; price: number }
interface OddsMarket { key: string; outcomes: OddsOutcome[] }
interface OddsEvent {
  id: string
  home_team: string
  away_team: string
  commence_time: string
  bookmakers: Array<{ markets: OddsMarket[] }>
}

export interface MatchOdds {
  home_team: string
  away_team: string
  commence_time: string
  h2h: { home: number | null; draw: number | null; away: number | null }
  totals: { over_2_5: number | null; under_2_5: number | null }
  btts: { yes: number | null; no: number | null }  // toujours null (btts non disponible en plan gratuit)
}

export async function getTodayOdds(region = 'eu'): Promise<MatchOdds[]> {
  const url = new URL(`${BASE_URL}/sports/${SPORT}/odds`)
  url.searchParams.set('apiKey', process.env.ODDS_API_KEY!)
  url.searchParams.set('regions', region)
  url.searchParams.set('markets', 'h2h,totals')  // btts retiré : non supporté plan gratuit
  url.searchParams.set('oddsFormat', 'decimal')
  url.searchParams.set('dateFormat', 'iso')

  const key = process.env.ODDS_API_KEY ?? ''
  console.log(`[odds-api] key length=${key.length} prefix=${key.slice(0, 6)}`)

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) {
    console.warn(`Odds API ${res.status} — continuing without real-time odds`)
    return []
  }

  const events: OddsEvent[] = await res.json()

  return events.map(event => {
    const allMarkets = event.bookmakers.flatMap(b => b.markets)
    const h2hOutcomes = allMarkets.filter(m => m.key === 'h2h').flatMap(m => m.outcomes)
    const totalsOutcomes = allMarkets.filter(m => m.key === 'totals').flatMap(m => m.outcomes)
    const bttsOutcomes = allMarkets.filter(m => m.key === 'btts').flatMap(m => m.outcomes)

    const avgOdds = (outcomes: OddsOutcome[], name: string) => {
      const matching = outcomes.filter(o => o.name.toLowerCase().includes(name.toLowerCase()))
      if (!matching.length) return null
      return Math.round((matching.reduce((s, o) => s + o.price, 0) / matching.length) * 100) / 100
    }

    return {
      home_team: event.home_team,
      away_team: event.away_team,
      commence_time: event.commence_time,
      h2h: {
        home: avgOdds(h2hOutcomes, event.home_team),
        draw: avgOdds(h2hOutcomes, 'draw'),
        away: avgOdds(h2hOutcomes, event.away_team),
      },
      totals: {
        over_2_5: avgOdds(totalsOutcomes, 'over'),
        under_2_5: avgOdds(totalsOutcomes, 'under'),
      },
      btts: {
        yes: avgOdds(bttsOutcomes, 'yes'),
        no: avgOdds(bttsOutcomes, 'no'),
      },
    }
  })
}

// Similarité par mots communs (robuste aux abréviations et variantes de noms)
function teamSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\b(fc|cf|sc|rc|ac|ss|afc|bsc|vfb|rcd|ssc|ud|cd)\b/g, '')
      .trim()
  const wa = normalize(a).split(/\s+/).filter(Boolean)
  const wb = normalize(b).split(/\s+/).filter(Boolean)
  const setB = new Set(wb)
  const intersection = wa.filter(w => setB.has(w)).length
  const union = new Set([...wa, ...wb]).size
  return union === 0 ? 0 : intersection / union
}

export function findMatchOdds(
  odds: MatchOdds[],
  homeTeam: string,
  awayTeam: string
): MatchOdds | null {
  const THRESHOLD = 0.3 // au moins 1 mot commun significatif

  let best: MatchOdds | null = null
  let bestScore = -1

  for (const o of odds) {
    const homeScore = teamSimilarity(o.home_team, homeTeam)
    const awayScore = teamSimilarity(o.away_team, awayTeam)
    const score = homeScore + awayScore

    if (homeScore >= THRESHOLD && awayScore >= THRESHOLD && score > bestScore) {
      bestScore = score
      best = o
    }
  }

  return best
}
