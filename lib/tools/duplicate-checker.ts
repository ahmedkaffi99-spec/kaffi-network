import { adminSupabase } from '@/lib/supabase/admin'
import type { PickCandidate } from '@/lib/types'

export async function checkDuplicates(
  picks: PickCandidate[],
  sessionId: string
): Promise<{ ok: boolean; duplicates: string[] }> {
  const today = new Date().toISOString().split('T')[0]
  const duplicates: string[] = []

  for (const pick of picks) {
    const { data } = await adminSupabase
      .from('published_matches')
      .select('id')
      .eq('home_team', pick.home_team)
      .eq('away_team', pick.away_team)
      .eq('match_date', today)
      .maybeSingle()

    if (data) duplicates.push(`${pick.home_team} - ${pick.away_team}`)
  }

  return { ok: duplicates.length === 0, duplicates }
}

export async function savePublishedMatches(
  picks: PickCandidate[],
  sessionId: string
): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  if (!picks.length) return

  await adminSupabase.from('published_matches').insert(
    picks.map(p => ({
      home_team: p.home_team,
      away_team: p.away_team,
      match_date: today,
      session_id: sessionId,
    }))
  )
}
