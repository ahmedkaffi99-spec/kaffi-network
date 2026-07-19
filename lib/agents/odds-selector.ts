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
// Chaque combiné (coupon) contient entre 8 et 15 matchs — pas une plage de
// cote. Les 3 paliers piochent dans le même pool de picks fiables mais
// selon des critères de risque différents (cote par match, pas cote
// combinée) : prudent = cotes les plus basses, audacieux = cotes les plus
// hautes, équilibré = mélange des deux extrémités.
export const MIN_PICKS_PER_COMBO = 8
export const MAX_PICKS_PER_COMBO = 15

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

function combinedOddsOf(picks: ReliablePick[]): number {
  return Math.round(picks.reduce((acc, p) => acc * p.odds, 1) * 100) / 100
}

/** Alterne du bas puis du haut d'une liste triée par cote croissante — mélange équilibré des risques. */
function interleaveFromBothEnds(sortedAsc: ReliablePick[], count: number): ReliablePick[] {
  const result: ReliablePick[] = []
  let lo = 0
  let hi = sortedAsc.length - 1
  let takeLow = true

  while (result.length < count && lo <= hi) {
    result.push(takeLow ? sortedAsc[lo++] : sortedAsc[hi--])
    takeLow = !takeLow
  }

  return result
}

function buildCombo(tier: Tier, picks: ReliablePick[], reasonSuffix: string, decisions: TierDecision[]): TierCombo {
  for (const p of picks) {
    decisions.push({ match: matchLabel(p), tier, included: true, reason: `Sélectionné — ${reasonSuffix}` })
  }
  return { tier, picks, combined_odds: combinedOddsOf(picks) }
}

/**
 * ÉTAPE 2 — composition des 3 combinés. Chaque coupon contient entre 8 et
 * 15 matchs (pas une plage de cote) : les picks sont partagés entre paliers
 * (un même match peut entrer dans plusieurs coupons), et ce qui différencie
 * les paliers est le NIVEAU DE RISQUE des matchs choisis, pas la cote
 * combinée finale (qui sera de toute façon élevée pour les 3 avec 8-15
 * matchs) — prudent pioche les cotes individuelles les plus basses,
 * audacieux les plus hautes, équilibré un mélange des deux.
 */
function composeTiers(reliable: ReliablePick[]): { combos: Partial<Record<Tier, TierCombo>>; decisions: TierDecision[] } {
  const combos: Partial<Record<Tier, TierCombo>> = {}
  const decisions: TierDecision[] = []

  if (reliable.length < MIN_PICKS_PER_COMBO) {
    for (const tier of ['prudent', 'equilibre', 'audacieux'] as Tier[]) {
      decisions.push({
        match: '—',
        tier,
        included: false,
        reason: `Seulement ${reliable.length} picks fiables — minimum ${MIN_PICKS_PER_COMBO} requis pour un coupon`,
      })
    }
    return { combos, decisions }
  }

  const byOddsAsc = [...reliable].sort((a, b) => a.odds - b.odds)
  const byOddsDesc = [...byOddsAsc].reverse()
  const count = Math.min(MAX_PICKS_PER_COMBO, reliable.length)

  combos.prudent = buildCombo('prudent', byOddsAsc.slice(0, count), 'cote individuelle parmi les plus basses du pool', decisions)
  combos.audacieux = buildCombo('audacieux', byOddsDesc.slice(0, count), 'cote individuelle parmi les plus hautes du pool', decisions)
  combos.equilibre = buildCombo('equilibre', interleaveFromBothEnds(byOddsAsc, count), 'mélange de cotes basses et hautes du pool', decisions)

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
        : `Palier ${tier} non généré aujourd'hui — moins de ${MIN_PICKS_PER_COMBO} picks fiables disponibles.`,
    })
  }

  if (!builtTiers.length) {
    blackboard.post({ from: 'odds-selector', type: 'result', content: 'Aucun palier constructible aujourd\'hui.' })
  }

  return { reliable_picks: reliable, excluded_picks: excluded, combos, decisions }
}
