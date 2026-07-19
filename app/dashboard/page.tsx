import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from '@/components/DashboardClient'
import type { PronosticSession, DashboardStats } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: todaySession }, { data: sessions }, { data: picks }] = await Promise.all([
    supabase
      .from('pronostic_sessions')
      .select('*, picks(*)')
      .eq('date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pronostic_sessions')
      .select('id, date, status, combined_odds, picks(result)')
      .gte('date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .order('date', { ascending: false })
      .limit(60),
    supabase
      .from('picks')
      .select('result, was_rejected')
      .eq('was_rejected', false)
      .not('result', 'is', null)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
  ])

  const allPicks = picks ?? []
  const wins = allPicks.filter(p => p.result === 'win').length
  const total = allPicks.filter(p => p.result !== 'void').length
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0

  const publishedToday = (sessions ?? []).filter(
    s => s.date === today && s.status === 'published'
  ).length

  const pendingReview = (sessions ?? []).filter(s => s.status === 'draft').length

  // Current streak
  const sortedSessions = [...(sessions ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  let streak = 0
  for (const s of sortedSessions) {
    const sessionPicks = (s.picks as Array<{ result: string | null }> | undefined) ?? []
    const hasPendingOrLoss = sessionPicks.some(p => !p.result || p.result === 'loss')
    if (!hasPendingOrLoss && sessionPicks.length > 0) streak++
    else break
  }

  const stats: DashboardStats = {
    total_this_month: (sessions ?? []).length,
    win_rate: winRate,
    pending_review: pendingReview,
    published_today: publishedToday,
    current_streak: streak,
    roi_this_month: 0,
  }

  return <DashboardClient todaySession={todaySession as PronosticSession | null} stats={stats} />
}
