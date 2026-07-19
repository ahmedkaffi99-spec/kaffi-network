import { renderMission } from '@/lib/agent-kernel'
import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { AgentMission } from '@/lib/agent-kernel/types'
import type { PickCandidate, Tier, ReliablePick, ExcludedPick, TierCombo, TierDecision, OddsSelectorOutput } from '@/lib/types'
import { getBookmakerQuotes, PRIORITY_BOOKMAKER_KEY } from '@/lib/tools/odds-api'

const MISSION: AgentMission = {
  role: 'odds-selector',
  label: 'le Sélecteur de cotes',
  responsibility:
    "décider, à partir des picks candidats de l'Analyste, lesquels ont une cote fiable (consensus bookmakers) et comment ils composent les 3 combinés finaux (prudent/équilibré/audacieux) — décision finale sur ce qui est réellement publié.",
  doesNot: [
    "Ne sélectionne aucun nouveau match et ne calcule aucune tendance statistique — délégué à l'Analyste.",
    'Ne rédige pas le post Telegram — délégué au Rédacteur.',
    'Ne valide pas la qualité finale avant publication — délégué au Superviseur.',
  ],
}

const MAX_BOOKMAKER_SPREAD = 0.20
export const MIN_PICKS_PER_COMBO = 2

export interface TierRange {
  tier: Tier
  min: number
  max: number
}

export const TIER_RANGES: TierRange[] = [
  { tier: 'prudent', min: 5, max: 30 },
  { tier: 'equilibre', min: 31, max: 70 },
  { tier: 'audacieux', min: 70, max: Infinity },
]

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function matchLabel(pick: PickCandidate): string {
  return `${pick.home_team} - ${pick.away_team} (${pick.bet_type})`
}

/**
 * ÉTAPE 1 — cote fiable par pick candidat. Un pick déjà validé par
 * l'Analyste peut être rejeté ici si le marché est jugé trop incertain
 * (écart entre bookmakers > 20%) — le Sélecteur de cotes a le dernier mot.
 */
async function selectReliableOdds(
  candidates: PickCandidate[]
): Promise<{ reliable: ReliablePick[]; excluded: ExcludedPick[] }> {
  const reliable: ReliablePick[] = []
  const excluded: ExcludedPick[] = []

  for (const pick of candidates) {
    const quotes = await getBookmakerQuotes(pick.home_team, pick.away_team, pick.bet_type)

    if (!quotes.length) {
      excluded.push({ match: matchLabel(pick), bet_type: pick.bet_type, reason: 'Aucune cote bookmaker disponible pour ce marché' })
      continue
    }

    const prices = quotes.map(q => q.price)
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const spread = (max - min) / min

    if (spread > MAX_BOOKMAKER_SPREAD) {
      excluded.push({
        match: matchLabel(pick),
        bet_type: pick.bet_type,
        reason: `Écart entre bookmakers ${(spread * 100).toFixed(1)}% > ${MAX_BOOKMAKER_SPREAD * 100}% — marché trop incertain`,
      })
      continue
    }

    const priority = quotes.find(q => q.bookmaker === PRIORITY_BOOKMAKER_KEY)
    const finalOdds = priority ? priority.price : median(prices)
    const source = priority ? '1xBet (priorité 1)' : `médiane sur ${quotes.length} bookmakers`

    reliable.push({ ...pick, odds: finalOdds, odds_source: source, bookmaker_spread_pct: Math.round(spread * 1000) / 10 })
  }

  return { reliable, excluded }
}

/**
 * ÉTAPE 2 — composition des 3 combinés. Les picks sont partagés entre
 * paliers (le même pick peut entrer dans plusieurs combinés) : chaque
 * palier construit indépendamment le combo maximal qui tient sous son
 * plafond, à partir du même pool trié par confiance décroissante. Le palier
 * audacieux n'a pas de plafond — sa cote combinée peut dépasser x70 sans
 * limite artificielle si assez de picks fiables sont disponibles.
 */
function composeTiers(reliable: ReliablePick[]): { combos: Partial<Record<Tier, TierCombo>>; decisions: TierDecision[] } {
  const sorted = [...reliable].sort((a, b) => b.trend_pct - a.trend_pct)
  const combos: Partial<Record<Tier, TierCombo>> = {}
  const decisions: TierDecision[] = []

  for (const range of TIER_RANGES) {
    const combo: ReliablePick[] = []
    let combinedOdds = 1

    for (const pick of sorted) {
      const projected = combinedOdds * pick.odds
      if (projected <= range.max) {
        combo.push(pick)
        combinedOdds = projected
        decisions.push({ match: matchLabel(pick), tier: range.tier, included: true, reason: `Combiné à ${combinedOdds.toFixed(2)} — dans la plage ${range.tier}` })
      } else {
        decisions.push({
          match: matchLabel(pick),
          tier: range.tier,
          included: false,
          reason: `Ajout ferait dépasser ${range.max === Infinity ? '∞' : range.max} (combiné projeté ${projected.toFixed(2)})`,
        })
      }
    }

    if (combo.length >= MIN_PICKS_PER_COMBO && combinedOdds >= range.min) {
      combos[range.tier] = { tier: range.tier, picks: combo, combined_odds: Math.round(combinedOdds * 100) / 100 }
    }
  }

  return { combos, decisions }
}

export async function decide(candidates: PickCandidate[], blackboard: Blackboard): Promise<OddsSelectorOutput> {
  const mission = renderMission(MISSION) // documente la mission dans le journal des agents, pas un prompt LLM — cet agent est déterministe
  blackboard.write('odds-selector-mission', mission)

  const { reliable, excluded } = await selectReliableOdds(candidates)
  blackboard.post({
    from: 'odds-selector',
    type: 'observation',
    content: `${reliable.length}/${candidates.length} picks avec cote fiable — ${excluded.length} rejetés (marché incertain ou cote absente).`,
  })

  const { combos, decisions } = composeTiers(reliable)
  const builtTiers = (Object.keys(combos) as Tier[]).filter(t => combos[t])

  for (const tier of ['prudent', 'equilibre', 'audacieux'] as Tier[]) {
    const combo = combos[tier]
    blackboard.post({
      from: 'odds-selector',
      to: 'writer',
      type: 'decision',
      content: combo
        ? `Palier ${tier} : ${combo.picks.length} picks, cote combinée ${combo.combined_odds}.`
        : `Palier ${tier} non généré aujourd'hui — cote atteignable insuffisante avec les picks fiables du jour.`,
    })
  }

  if (!builtTiers.length) {
    blackboard.post({ from: 'odds-selector', type: 'result', content: 'Aucun palier constructible aujourd\'hui.' })
  }

  return { reliable_picks: reliable, excluded_picks: excluded, combos, decisions }
}
