import { renderMission } from '@/lib/agent-kernel'
import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { AgentMission } from '@/lib/agent-kernel/types'
import type { PickCandidate, Tier, ReliablePick, ExcludedPick, TierCombo, TierDecision, OddsSelectorOutput } from '@/lib/types'
import { getBookmakerQuotes, PRIORITY_BOOKMAKER_KEY } from '@/lib/tools/odds-api'

// Appelé en interne par lib/agents/analyst.ts:runAnalystAndOdds — un seul
// appel visible depuis l'orchestrateur pour Analyste + Sélecteur de cotes,
// mais ce module reste séparé et 100% déterministe (aucun appel modèle).
const MISSION: AgentMission = {
  role: 'odds-selector',
  label: 'le Sélecteur de cotes',
  responsibility:
    "décider, à partir des picks candidats de l'Analyste, lesquels ont une cote fiable (consensus bookmakers) et comment ils composent les 3 combinés finaux (prudent/équilibré/audacieux) — décision finale sur ce qui est réellement publié.",
  doesNot: [
    "Ne sélectionne aucun nouveau match et ne calcule aucune tendance statistique — délégué à l'Analyste.",
    'Ne rédige pas le post Telegram — délégué au Rédacteur.',
    "Ne valide pas la qualité finale avant publication — cette décision revient à l'utilisateur depuis le dashboard.",
  ],
}

const MAX_BOOKMAKER_SPREAD = 0.20

// Un combiné perd dès qu'UN pick perd — le NOMBRE de picks contrôle donc la
// probabilité de gain final bien plus que la cote individuelle. Avec des
// picks à ~85% de confiance chacun, un combiné de 15 picks ne gagne que
// ~9% du temps (0.85^15) même si chaque pick est excellent individuellement
// — incompatible avec un palier "prudent" censé gagner majoritairement.
// Les 3 paliers sont donc différenciés par DEUX critères combinés :
// - le nombre de picks (ce qui pilote la probabilité de gain du combiné)
// - la cote individuelle de chaque pick (prudent = basse, audacieux = haute)
// prudent  : peu de picks, cote basse par pick  → gagne la majorité du temps
// équilibré: nombre intermédiaire, cotes mixtes → compromis
// audacieux: plus de picks et/ou cotes hautes   → rare, mais gros gain
export const TIER_PICK_RANGE: Record<Tier, { min: number; max: number }> = {
  prudent: { min: 2, max: 4 },
  equilibre: { min: 5, max: 8 },
  audacieux: { min: 8, max: 15 },
}
// Minimum absolu pour tenter de construire ne serait-ce qu'un seul palier —
// le plus bas des trois seuils ci-dessus (prudent).
export const MIN_PICKS_PER_COMBO = TIER_PICK_RANGE.prudent.min

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function matchLabel(pick: PickCandidate): string {
  return `${pick.home_team} - ${pick.away_team} (${pick.bet_type})`
}

// Identifie le MATCH (pas le pick) — l'Analyste peut proposer plusieurs
// prédictions indépendantes sur un même match (ex: "Over 2.5" et "BTTS
// Oui" pour PSG-Barça), mais un seul de ces picks doit finir dans UN
// combiné donné : deux paris sur le même match dans le même coupon sont
// des résultats corrélés, pas une vraie diversification.
function matchKey(pick: PickCandidate): string {
  return `${pick.home_team}-${pick.away_team}`
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

// Un seul pick par match dans un même combiné — voir matchKey().
function takeUniqueByMatch(sorted: ReliablePick[], count: number): ReliablePick[] {
  const result: ReliablePick[] = []
  const seen = new Set<string>()
  for (const pick of sorted) {
    if (result.length >= count) break
    const key = matchKey(pick)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(pick)
  }
  return result
}

/** Alterne du bas puis du haut d'une liste triée par cote croissante — mélange équilibré des risques. */
function interleaveFromBothEnds(sortedAsc: ReliablePick[], count: number): ReliablePick[] {
  const result: ReliablePick[] = []
  const seen = new Set<string>()
  let lo = 0
  let hi = sortedAsc.length - 1
  let takeLow = true

  while (result.length < count && lo <= hi) {
    const candidate = takeLow ? sortedAsc[lo] : sortedAsc[hi]
    if (takeLow) lo++
    else hi--

    const key = matchKey(candidate)
    if (seen.has(key)) continue // retente le même côté, pointeur déjà avancé

    seen.add(key)
    result.push(candidate)
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
 * ÉTAPE 2 — composition des 3 combinés. Chaque palier a sa propre plage de
 * nombre de picks (TIER_PICK_RANGE) — pas la même pour les 3 — en plus de sa
 * propre logique de cote : prudent pioche les cotes individuelles les plus
 * basses (et le moins de picks, pour maximiser la probabilité de gain du
 * combiné), audacieux les plus hautes (et le plus de picks, accepte un gain
 * rare mais élevé), équilibré un mélange des deux à un volume intermédiaire.
 */
function composeTiers(reliable: ReliablePick[]): { combos: Partial<Record<Tier, TierCombo>>; decisions: TierDecision[] } {
  const combos: Partial<Record<Tier, TierCombo>> = {}
  const decisions: TierDecision[] = []

  const byOddsAsc = [...reliable].sort((a, b) => a.odds - b.odds)
  const byOddsDesc = [...byOddsAsc].reverse()
  // Le vrai plafond, c'est le nombre de MATCHS distincts — plusieurs picks
  // fiables sur le même match (ex: Over 2.5 ET BTTS Oui pour PSG-Barça) ne
  // comptent qu'une fois, un seul finira dans un combiné donné.
  const uniqueMatchCount = new Set(reliable.map(matchKey)).size

  for (const tier of ['prudent', 'equilibre', 'audacieux'] as Tier[]) {
    const { min, max } = TIER_PICK_RANGE[tier]

    if (uniqueMatchCount < min) {
      decisions.push({
        match: '—',
        tier,
        included: false,
        reason: `Seulement ${uniqueMatchCount} matchs distincts avec cote fiable — minimum ${min} requis pour le palier ${tier}`,
      })
      continue
    }

    const count = Math.min(max, uniqueMatchCount)

    if (tier === 'prudent') {
      combos.prudent = buildCombo('prudent', takeUniqueByMatch(byOddsAsc, count), `${count} picks à cote individuelle basse — vise à gagner majoritairement`, decisions)
    } else if (tier === 'audacieux') {
      combos.audacieux = buildCombo('audacieux', takeUniqueByMatch(byOddsDesc, count), `${count} picks à cote individuelle haute — gain rare mais élevé`, decisions)
    } else {
      combos.equilibre = buildCombo('equilibre', interleaveFromBothEnds(byOddsAsc, count), `${count} picks — mélange de cotes basses et hautes`, decisions)
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
        : `Palier ${tier} non généré aujourd'hui — moins de ${TIER_PICK_RANGE[tier].min} picks fiables disponibles.`,
    })
  }

  if (!builtTiers.length) {
    blackboard.post({ from: 'odds-selector', type: 'result', content: 'Aucun palier constructible aujourd\'hui.' })
  }

  return { reliable_picks: reliable, excluded_picks: excluded, combos, decisions }
}
