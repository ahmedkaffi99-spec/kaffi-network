import { createClient } from '@/lib/supabase/server'
import { ChatHubClient, type ChatSessionSummary } from '@/components/ChatHubClient'

export const dynamic = 'force-dynamic'

export default async function ChatPage() {
  const supabase = await createClient()

  const { data: sessions } = await supabase
    .from('pronostic_sessions')
    .select('id, date, tier, status, combined_odds, picks(home_team, away_team, was_rejected)')
    .order('date', { ascending: false })
    .limit(60)

  return <ChatHubClient sessions={(sessions ?? []) as unknown as ChatSessionSummary[]} />
}
