import { adminSupabase } from '@/lib/supabase/admin'
import { getMatchResult } from '@/lib/tools/football-api'
import { updatePerformance } from '@/lib/tools/memory'
import { sendMessage, formatResultAnnouncement } from '@/lib/tools/telegram'
import type { Tier } from '@/lib/types'

interface PendingPick {
  id: string
  session_id: string
  home_team: string
  away_team: string
  competition: string
  match_datetime: string
  bet_type: string
  odds: number
  result: null
}

interface SessionWithPicks {
  id: string
  tier: Tier
  date: string
  combined_odds: number | null
  telegram_msg_id: string | null
  picks: Array<{ result: 'win' | 'loss' | 'void' | null; was_rejected: boolean }>
}

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

  if (bt.includes('btts oui') || bt.includes('les deux équipes marquent'))
    return homeGoals > 0 && awayGoals > 0 ? 'win' : 'loss'
  if (bt.includes('btts non'))
    return homeGoals === 0 || awayGoals === 0 ? 'win' : 'loss'

  if (bt.includes('victoire') && bt.includes('domicile')) return homeGoals > awayGoals ? 'win' : 'loss'
  if (bt.includes('victoire') && bt.includes('extérieur')) return awayGoals > homeGoals ? 'win' : 'loss'
  if (bt.includes('nul') || bt.includes('draw')) return homeGoals === awayGoals ? 'win' : 'loss'

  // Victoire [nom équipe] — domicile si nommée, sinon void
  if (bt.startsWith('victoire ')) {
    const teamName = bt.replace('victoire ', '').trim()
    if (teamName && homeGoals > awayGoals) return 'win'
    if (teamName && awayGoals > homeGoals) return 'loss'
  }

  return 'void'
}

export async function checkPendingResults(): Promise<{ checked: number; updated: number }> {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

  const { data: pending } = await adminSupabase
    .from('picks')
    .select('id, session_id, home_team, away_team, competition, match_datetime, bet_type, odds, result')
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

    // Utilise la compétition directement depuis le pick (plus besoin de requête supplémentaire)
    const competition = pick.competition || 'Unknown'
    await updatePerformance(pick.bet_type, competition, result, pick.odds)
    updated++
  }

  return { checked: pending.length, updated }
}

/**
 * Poste le résultat d'un combiné sur Telegram une fois que TOUS ses picks
 * sont résolus (win/loss/void) — un seul pick perdant fait perdre tout le
 * combiné, comme un vrai pari combiné. Chaque session n'est annoncée
 * qu'une fois (result_posted_at). Appelé après checkPendingResults() dans
 * le même cron, pour que les picks soient déjà à jour.
 */
export async function announceSessionResults(): Promise<{ checked: number; announced: number }> {
  const { data: sessions } = await adminSupabase
    .from('pronostic_sessions')
    .select('id, tier, date, combined_odds, telegram_msg_id, picks(result, was_rejected)')
    .eq('status', 'published')
    .is('result_posted_at', null)
    .limit(20)

  if (!sessions?.length) return { checked: 0, announced: 0 }

  let announced = 0

  for (const session of sessions as unknown as SessionWithPicks[]) {
    const picks = session.picks.filter(p => !p.was_rejected)
    if (!picks.length) continue

    const allResolved = picks.every(p => p.result !== null)
    if (!allResolved) continue

    const hasLoss = picks.some(p => p.result === 'loss')
    const allVoid = picks.every(p => p.result === 'void')
    const comboResult: 'win' | 'loss' | 'void' = hasLoss ? 'loss' : allVoid ? 'void' : 'win'
    const wins = picks.filter(p => p.result === 'win').length

    const message = formatResultAnnouncement({
      tier: session.tier,
      date: session.date,
      comboResult,
      wins,
      total: picks.length,
      combinedOdds: session.combined_odds,
    })

    await sendMessage(message, session.telegram_msg_id ?? undefined)

    await adminSupabase
      .from('pronostic_sessions')
      .update({ combo_result: comboResult, result_posted_at: new Date().toISOString() })
      .eq('id', session.id)

    announced++
  }

  return { checked: sessions.length, announced }
}
