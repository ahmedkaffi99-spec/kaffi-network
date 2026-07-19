import { readFileSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'

// Drapeaux réels (paquet npm "flag-icons", bundlé localement — pas de
// dépendance réseau au moment du rendu). Les emoji drapeaux (🇪🇸) ont le
// même problème que les autres emoji dans Satori (glyphe cassé), donc on
// rasterise de vraies images SVG → PNG une fois, mises en cache.
const FLAG_DIR = join(process.cwd(), 'node_modules', 'flag-icons', 'flags', '4x3')

const cache = new Map<string, string | null>()

async function loadFlagDataUri(iso: string): Promise<string | null> {
  if (cache.has(iso)) return cache.get(iso) ?? null
  try {
    const svgBuffer = readFileSync(join(FLAG_DIR, `${iso}.svg`))
    const pngBuffer = await sharp(svgBuffer).resize(32, 24).png().toBuffer()
    const dataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`
    cache.set(iso, dataUri)
    return dataUri
  } catch {
    cache.set(iso, null)
    return null
  }
}

// Compétition club → pays (un seul drapeau représentatif par match, pas un
// par équipe — les deux équipes d'un championnat national sont du même pays).
const COMPETITION_FLAG: Record<string, string> = {
  'premier league': 'gb',
  championship: 'gb',
  'la liga': 'es',
  'serie a': 'it',
  bundesliga: 'de',
  'ligue 1': 'fr',
  'liga portugal': 'pt',
  eredivisie: 'nl',
  'campeonato brasileiro': 'br',
  'champions league': 'eu',
  'uefa champions league': 'eu',
  'europa league': 'eu',
  'uefa europa league': 'eu',
}

// Équipes nationales (Coupe du monde, amicaux internationaux, etc.) — le nom
// de l'équipe EST le pays, donc un drapeau par équipe a du sens ici.
const COUNTRY_ISO: Record<string, string> = {
  spain: 'es', argentina: 'ar', france: 'fr', germany: 'de', italy: 'it',
  england: 'gb', portugal: 'pt', netherlands: 'nl', brazil: 'br', belgium: 'be',
  croatia: 'hr', morocco: 'ma', senegal: 'sn', usa: 'us', 'united states': 'us',
  mexico: 'mx', 'south korea': 'kr', 'korea republic': 'kr', japan: 'jp',
  sweden: 'se', finland: 'fi', denmark: 'dk', norway: 'no', poland: 'pl',
  switzerland: 'ch', austria: 'at', ukraine: 'ua', wales: 'gb-wls', scotland: 'gb-sct',
}

export type MatchFlags =
  | { mode: 'teams'; home: string | null; away: string | null }
  | { mode: 'competition'; flag: string | null }

export async function resolveMatchFlags(competition: string, homeTeam: string, awayTeam: string): Promise<MatchFlags> {
  const homeIso = COUNTRY_ISO[homeTeam.trim().toLowerCase()]
  const awayIso = COUNTRY_ISO[awayTeam.trim().toLowerCase()]

  if (homeIso && awayIso) {
    const [home, away] = await Promise.all([loadFlagDataUri(homeIso), loadFlagDataUri(awayIso)])
    return { mode: 'teams', home, away }
  }

  const compIso = COMPETITION_FLAG[competition.trim().toLowerCase()]
  const flag = compIso ? await loadFlagDataUri(compIso) : null
  return { mode: 'competition', flag }
}
