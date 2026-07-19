import { adminSupabase } from '@/lib/supabase/admin'
import type { BetPerformance } from '@/lib/types'

// Lit la performance historique d'un type de pari (pour pondérer l'analyste)
export async function getBetPerformance(
  betType: string,
  competition: string
): Promise<BetPerformance | null> {
  const { data } = await adminSupabase
    .from('bet_performance')
    .select('*')
    .eq('bet_type', betType)
    .eq('competition', competition)
    .single()
  return data
}

// Lit toute la mémoire de performance (résumé pour l'analyste)
export async function getAllPerformance(): Promise<BetPerformance[]> {
  const { data } = await adminSupabase
    .from('bet_performance')
    .select('*')
    .order('last_updated', { ascending: false })
  return data ?? []
}

// Met à jour la performance après résultat d'un pick
export async function updatePerformance(
  betType: string,
  competition: string,
  result: 'win' | 'loss' | 'void',
  odds: number
): Promise<void> {
  const existing = await getBetPerformance(betType, competition)

  if (!existing) {
    await adminSupabase.from('bet_performance').insert({
      bet_type: betType,
      competition,
      total_picks: 1,
      wins: result === 'win' ? 1 : 0,
      losses: result === 'loss' ? 1 : 0,
      voids: result === 'void' ? 1 : 0,
      avg_odds: odds,
      last_updated: new Date().toISOString(),
    })
    return
  }

  const newTotal = existing.total_picks + 1
  const newAvgOdds = existing.avg_odds
    ? Math.round(((existing.avg_odds * existing.total_picks + odds) / newTotal) * 100) / 100
    : odds

  await adminSupabase
    .from('bet_performance')
    .update({
      total_picks: newTotal,
      wins: existing.wins + (result === 'win' ? 1 : 0),
      losses: existing.losses + (result === 'loss' ? 1 : 0),
      voids: existing.voids + (result === 'void' ? 1 : 0),
      avg_odds: newAvgOdds,
      last_updated: new Date().toISOString(),
    })
    .eq('bet_type', betType)
    .eq('competition', competition)
}

// Formate la mémoire en contexte lisible par l'analyste
export function formatMemoryContext(performance: BetPerformance[]): string {
  if (!performance.length) return 'Aucun historique de performance disponible.'

  const lines = performance
    .filter(p => p.total_picks >= 3)
    .sort((a, b) => {
      const wrA = a.total_picks > 0 ? a.wins / a.total_picks : 0
      const wrB = b.total_picks > 0 ? b.wins / b.total_picks : 0
      return wrB - wrA
    })
    .slice(0, 15)
    .map(p => {
      const wr = p.total_picks > 0 ? Math.round((p.wins / p.total_picks) * 100) : 0
      return `${p.bet_type} (${p.competition}): ${wr}% succès sur ${p.total_picks} picks`
    })

  return lines.join('\n')
}
