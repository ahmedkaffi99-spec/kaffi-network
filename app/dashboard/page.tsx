import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from '@/components/DashboardClient'
import type { PronosticSession, DashboardStats } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: todaySessions }, { data: sessions }, { data: picks }] = await Promise.all([
    supabase
      .from('pronostic_sessions')
      .select('*, picks(*)')
      .eq('date', today)
      .order('tier', { ascending: true }),
    supabase
      .from('pronostic_sessions')
      .select('id, date, status, combined_odds, combo_result, picks(result, was_rejected)')
      .gte('date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .order('date', { ascending: false })
      .limit(60),
    supabase
      .from('picks')
      .select('result, odds, was_rejected')
      .eq('was_rejected', false)
      .not('result', 'is', null)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
  ])

  const allPicks = picks ?? []
  const wins = allPicks.filter(p => p.result === 'win').length
  const losses = allPicks.filter(p => p.result === 'loss').length
  const total = wins + losses
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0

  // ROI : (somme cotes gagnées - nombre pertes) / total misé × 100
  const winOddsSum = allPicks
    .filter(p => p.result === 'win')
    .reduce((acc, p) => acc + ((p.odds as number) - 1), 0)
  const roi = total > 0 ? Math.round(((winOddsSum - losses) / total) * 100) / 100 : 0

  const publishedToday = (sessions ?? []).filter(
    s => s.date === today && s.status === 'published'
  ).length
  const pendingReview = (sessions ?? []).filter(s => s.status === 'draft').length

  // Combinés publiés : en cours (résultat pas encore annoncé) vs terminés (gagné/perdu/annulé)
  const publishedCombos = (sessions ?? []).filter(s => s.status === 'published')
  const combosEnCours = publishedCombos.filter(s => !s.combo_result).length
  const combosTermines = publishedCombos.filter(s => s.combo_result).length
  const combosGagnes = publishedCombos.filter(s => s.combo_result === 'win').length
  const combosPerdus = publishedCombos.filter(s => s.combo_result === 'loss').length

  // Streak : sessions consécutives sans aucune perte
  const sortedSessions = [...(sessions ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  let streak = 0
  for (const s of sortedSessions) {
    // was_rejected exclut les picks retirés via le chat (voir
    // app/api/sessions/[id]/apply-change) — leur résultat reste toujours
    // null, ce qui fausserait "allResolved" sans ce filtre.
    const sessionPicks = ((s.picks as Array<{ result: string | null; was_rejected: boolean }> | undefined) ?? []).filter(
      p => !p.was_rejected
    )
    const hasLoss = sessionPicks.some(p => p.result === 'loss')
    const allResolved = sessionPicks.length > 0 && sessionPicks.every(p => p.result !== null)
    if (allResolved && !hasLoss) streak++
    else break
  }

  const stats: DashboardStats = {
    total_this_month: (sessions ?? []).length,
    win_rate: winRate,
    pending_review: pendingReview,
    published_today: publishedToday,
    current_streak: streak,
    roi_this_month: roi,
    combos_en_cours: combosEnCours,
    combos_termines: combosTermines,
    combos_gagnes: combosGagnes,
    combos_perdus: combosPerdus,
  }

  return <DashboardClient todaySessions={(todaySessions ?? []) as PronosticSession[]} stats={stats} />
}
