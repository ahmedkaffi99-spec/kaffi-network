import { createClient } from '@/lib/supabase/server'
import { CommandCenterClient } from '@/components/CommandCenterClient'
import type { PronosticSession } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function CommandCenterPage() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const { data: todaySessions } = await supabase
    .from('pronostic_sessions')
    .select('*, picks(*)')
    .eq('date', today)
    .order('tier', { ascending: true })

  return <CommandCenterClient todaySessions={(todaySessions ?? []) as PronosticSession[]} />
}
