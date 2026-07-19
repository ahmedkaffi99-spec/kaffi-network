import { createClient } from '@/lib/supabase/server'
import { PronosticsClient } from '@/components/PronosticsClient'
import type { PronosticSession } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function PronosticsPage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('pronostic_sessions')
    .select('*, picks(*)')
    .order('date', { ascending: false })
    .limit(100)

  return <PronosticsClient sessions={(data ?? []) as PronosticSession[]} />
}
