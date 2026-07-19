import { adminSupabase } from '@/lib/supabase/admin'
import { getMatchResult } from '@/lib/tools/football-api'
import { updatePerformance } from '@/lib/tools/memory'

interface PendingPick {
  id: string
  session_id: string
  home_team: string
  away_team: string
  match_datetime: string
  bet_type: string
  odds: number
  result: null
}

// Détermine si un pick est gagnant selon le résultat du match
function evaluateResult(
  betType: string,
  homeGoals: number,
  awayGoals: number
): 'win' | 'loss' | 'void' {
  const total = homeGoals + awayGoals
  const bt = betType.toLowerCase()

  if (bt.includes('moins de 1.5') || bt.includes('under 1.5')) return total < 1.5 ? 'win' : 'loss'
  if (bt.includes('plus de 1.5') || bt.includes('over 1.5')) return total > 1.5 ? 'win' : 'loss'
  if (bt.includes('moins de 2.5') || bt.includes('under 2.5')) return total < 2.5 ? 'win' : 'loss'
  if (bt.includes('plus de 2.5') || bt.includes('over 2.5')) return total > 2.5 ? 'win' : 'loss'
  if (bt.includes('moins de 3.5') || bt.includes('under 3.5')) return total < 3.5 ? 'win' : 'loss'
  if (bt.includes('plus de 3.5') || bt.includes('over 3.5')) return total > 3.5 ? 'win' : 'loss'

  if (bt.includes('btts oui') || bt.includes('les deux équipes marquent')) {
    return homeGoals > 0 && awayGoals > 0 ? 'win' : 'loss'
  }
  if (bt.includes('btts non')) {
    return homeGoals === 0 || awayGoals === 0 ? 'win' : 'loss'
  }

  if (bt.includes('victoire') && bt.includes('domicile')) return homeGoals > awayGoals ? 'win' : 'loss'
  if (bt.includes('victoire') && bt.includes('extérieur')) return awayGoals > homeGoals ? 'win' : 'loss'

  // Victoire X (équipe) — tente de matcher le nom de l'équipe dans le type de pari
  if (bt.startsWith('victoire ')) return 'void' // ne peut pas déterminer sans le nom

  return 'void'
}

export async function checkPendingResults(): Promise<{ checked: number; updated: number }> {
  const now = new Date()

  // Récupère les picks sans résultat dont le match devrait être terminé (match_datetime + 2h)
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

  const { data: pending } = await adminSupabase
    .from('picks')
    .select('id, session_id, home_team, away_team, match_datetime, bet_type, odds, result')
    .is('result', null)
    .eq('was_rejected', false)
    .lt('match_datetime', cutoff)
    .limit(50)

  if (!pending?.length) return { checked: 0, updated: 0 }

  let updated = 0

  for (const pick of pending as PendingPick[]) {
    const matchDate = pick.match_datetime.split('T')[0]
    const score = await getMatchResult(pick.home_team, pick.away_team, matchDate)

    if (!score) continue

    const result = evaluateResult(pick.bet_type, score.home, score.away)

    await adminSupabase
      .from('picks')
      .update({ result, result_checked_at: new Date().toISOString() })
      .eq('id', pick.id)

    // Récupère la compétition pour la mémoire
    const { data: session } = await adminSupabase
      .from('pronostic_sessions')
      .select('analyst_output')
      .eq('id', pick.session_id)
      .single()

    const competition = (session?.analyst_output as { picks_retenus?: Array<{ competition?: string }> })
      ?.picks_retenus?.find(
        (p: { competition?: string; home_team?: string }) => p.home_team === pick.home_team
      )?.competition ?? 'Unknown'

    await updatePerformance(pick.bet_type, competition, result, pick.odds)
    updated++
  }

  return { checked: pending.length, updated }
}
