const BASE_URL = 'https://api.the-odds-api.com/v4'
const SPORT = 'soccer'

interface OddsOutcome { name: string; price: number; point?: number }
interface OddsMarket { key: string; outcomes: OddsOutcome[] }
interface OddsBookmaker { key: string; title: string; markets: OddsMarket[] }
interface OddsEvent {
  id: string
  sport_key: string
  sport_title: string
  home_team: string
  away_team: string
  commence_time: string
  bookmakers: OddsBookmaker[]
}

// Bookmaker prioritaire pour la cote finale — cohérence avec le lien affilié.
const PRIORITY_BOOKMAKER_KEY = '1xbet'

// Le sport_key 'soccer' interroge TOUTES les compétitions en une requête —
// pratique pour économiser le quota, mais ça inclut des championnats
// obscurs (réserves, divisions mineures de pays peu suivis) que les
// abonnés ne reconnaissent pas. Utilisé pour filtrer en mode "cotes
// uniquement" (lib/agents/analyst.ts), où il n'y a pas de données
// API-Football pour recadrer la sélection — même liste de championnats
// "connus" que lib/tools/flags.ts::COMPETITION_FLAG, pour rester cohérent.
const KNOWN_LEAGUE_SPORT_KEYS = [
  'epl', // Premier League (soccer_epl)
  'efl_champ', // Championship
  'la_liga', // La Liga
  'serie_a', // Serie A (Italie)
  'bundesliga', // Bundesliga
  'ligue_one', // Ligue 1
  'primeira_liga', // Liga Portugal
  'eredivisie', // Eredivisie
  'brazil_campeonato', // Campeonato Brasileiro
  'champs_league', // Ligue des Champions (UEFA + autres confédérations)
  'europa_league', // Europa League
  'conference_league', // Conference League
  'fifa_world_cup', // Coupe du monde
  'uefa_euro', // Euro (UEFA)
  'mls', // Major League Soccer
  'liga_mx', // Liga MX
]

export function isKnownLeague(sportKey: string): boolean {
  const key = sportKey.toLowerCase()
  return KNOWN_LEAGUE_SPORT_KEYS.some(k => key.includes(k))
}

export interface MatchOdds {
  sport_key: string
  sport_title: string
  home_team: string
  away_team: string
  commence_time: string
  h2h: { home: number | null; draw: number | null; away: number | null }
  totals: { over_2_5: number | null; under_2_5: number | null }
  btts: { yes: number | null; no: number | null }  // toujours null (btts non disponible en plan gratuit)
  // Handicap — seule ligne représentative (celle du premier bookmaker qui en
  // propose une), affichée à titre indicatif. La vérification multi-
  // bookmaker d'un pick handicap précis se fait via getBookmakerQuotes(),
  // qui filtre par valeur de point exacte, pas via ce champ.
  spreads: { home_point: number | null; home_price: number | null; away_point: number | null; away_price: number | null }
}

export async function getTodayOdds(region = 'eu'): Promise<MatchOdds[]> {
  const url = new URL(`${BASE_URL}/sports/${SPORT}/odds`)
  url.searchParams.set('apiKey', process.env.ODDS_API_KEY!)
  url.searchParams.set('regions', region)
  url.searchParams.set('markets', 'h2h,totals,spreads')  // btts retiré : non supporté plan gratuit
  url.searchParams.set('oddsFormat', 'decimal')
  url.searchParams.set('dateFormat', 'iso')

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
    const spreadsOutcomes = allMarkets.filter(m => m.key === 'spreads').flatMap(m => m.outcomes)

    const avgOdds = (outcomes: OddsOutcome[], name: string) => {
      const matching = outcomes.filter(o => o.name.toLowerCase().includes(name.toLowerCase()))
      if (!matching.length) return null
      return Math.round((matching.reduce((s, o) => s + o.price, 0) / matching.length) * 100) / 100
    }

    // Ligne représentative (premier bookmaker qui en propose une) — juste
    // pour informer l'Analyste qu'un handicap existe. La cote publiée vient
    // toujours de la vérification multi-bookmaker du Sélecteur de cotes.
    const homeSpread = spreadsOutcomes.find(o => o.name === event.home_team && o.point != null)
    const awaySpread = spreadsOutcomes.find(o => o.name === event.away_team && o.point != null)

    return {
      sport_key: event.sport_key,
      sport_title: event.sport_title,
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
      spreads: {
        home_point: homeSpread?.point ?? null,
        home_price: homeSpread?.price ?? null,
        away_point: awaySpread?.point ?? null,
        away_price: awaySpread?.price ?? null,
      },
    }
  })
}

// Cache en mémoire du process — évite de refaire un fetch par pick candidat
// quand l'Odds Selector interroge plusieurs matchs du même run.
let rawEventsCache: { data: OddsEvent[]; fetchedAt: number } | null = null
const RAW_CACHE_TTL_MS = 5 * 60 * 1000

async function fetchRawOddsEvents(region = 'eu'): Promise<OddsEvent[]> {
  if (rawEventsCache && Date.now() - rawEventsCache.fetchedAt < RAW_CACHE_TTL_MS) {
    return rawEventsCache.data
  }

  const url = new URL(`${BASE_URL}/sports/${SPORT}/odds`)
  url.searchParams.set('apiKey', process.env.ODDS_API_KEY!)
  url.searchParams.set('regions', region)
  url.searchParams.set('markets', 'h2h,totals,spreads')
  url.searchParams.set('oddsFormat', 'decimal')
  url.searchParams.set('dateFormat', 'iso')

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) {
    console.warn(`Odds API ${res.status} — cotes brutes indisponibles`)
    return []
  }

  const data = (await res.json()) as OddsEvent[]
  rawEventsCache = { data, fetchedAt: Date.now() }
  return data
}

// Similarité par mots communs (robuste aux abréviations et variantes de noms)
export function teamSimilarity(a: string, b: string): number {
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

// ─── Cotes brutes par bookmaker (Odds Selector) ────────────────────────────

export interface BookmakerQuote {
  bookmaker: string // clé The Odds API (ex: '1xbet', 'pinnacle')
  price: number
}

// Reconnaît le marché/l'issue ciblés par un bet_type texte libre — même
// heuristique que lib/tools/result-checker.ts::evaluateResult (FR + EN, le
// Rédacteur/Analyste ne phrase pas toujours identiquement).
function matchOutcome(
  betType: string,
  homeTeam: string,
  awayTeam: string
): { marketKey: string; matches: (outcome: OddsOutcome) => boolean } | null {
  const bt = betType.toLowerCase()

  if (bt.includes('plus de 2.5') || bt.includes('over 2.5')) {
    return { marketKey: 'totals', matches: o => o.name.toLowerCase().includes('over') }
  }
  if (bt.includes('moins de 2.5') || bt.includes('under 2.5')) {
    return { marketKey: 'totals', matches: o => o.name.toLowerCase().includes('under') }
  }
  if (bt.includes('handicap')) {
    // "Handicap Real Madrid -1.5" — la ligne (point) doit matcher EXACTEMENT
    // celle du bookmaker (des lignes différentes ne sont pas comparables,
    // même erreur qu'on veut éviter que sur totals) et l'équipe visée.
    const pointMatch = betType.match(/[+-]?\d+(?:\.\d+)?/)
    const point = pointMatch ? parseFloat(pointMatch[0]) : null
    if (point == null) return null
    const targetTeam = teamSimilarity(betType, homeTeam) >= teamSimilarity(betType, awayTeam) ? homeTeam : awayTeam
    return {
      marketKey: 'spreads',
      matches: o => teamSimilarity(o.name, targetTeam) >= 0.3 && o.point != null && Math.abs(o.point - point) < 0.01,
    }
  }
  if (bt.includes('victoire') && (bt.includes('domicile') || bt.includes('home'))) {
    return { marketKey: 'h2h', matches: o => teamSimilarity(o.name, homeTeam) >= 0.3 }
  }
  if (bt.includes('victoire') && (bt.includes('extérieur') || bt.includes('exterieur') || bt.includes('away'))) {
    return { marketKey: 'h2h', matches: o => teamSimilarity(o.name, awayTeam) >= 0.3 }
  }
  if (bt.includes('nul') || bt.includes('draw')) {
    return { marketKey: 'h2h', matches: o => o.name.toLowerCase().includes('draw') }
  }

  // BTTS et autres marchés non couverts par le plan gratuit The Odds API
  return null
}

/**
 * Détail des cotes par bookmaker pour un pick candidat donné — utilisé par
 * l'Odds Selector pour choisir la cote 1xBet en priorité, sinon la médiane,
 * et détecter un marché trop incertain (écart entre bookmakers).
 */
export async function getBookmakerQuotes(homeTeam: string, awayTeam: string, betType: string): Promise<BookmakerQuote[]> {
  const outcome = matchOutcome(betType, homeTeam, awayTeam)
  if (!outcome) return []

  const events = await fetchRawOddsEvents()
  const THRESHOLD = 0.3
  const event = events.find(
    e => teamSimilarity(e.home_team, homeTeam) >= THRESHOLD && teamSimilarity(e.away_team, awayTeam) >= THRESHOLD
  )
  if (!event) return []

  const quotes: BookmakerQuote[] = []
  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find(m => m.key === outcome.marketKey)
    const outcomeEntry = market?.outcomes.find(o => outcome.matches(o))
    if (outcomeEntry) quotes.push({ bookmaker: bookmaker.key, price: outcomeEntry.price })
  }
  return quotes
}

export { PRIORITY_BOOKMAKER_KEY }
