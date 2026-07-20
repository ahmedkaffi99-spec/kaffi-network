import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runPipeline } from '@/lib/orchestrator'

export const maxDuration = 300

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const date = typeof body?.date === 'string' ? body.date : undefined
  // runId généré côté navigateur (voir components/DashboardClient.tsx) pour
  // pouvoir démarrer le polling de la vue "live" avant même que ce run ne
  // commence à poster des messages.
  const runId = typeof body?.runId === 'string' ? body.runId : undefined

  const result = await runPipeline(date, runId)
  return NextResponse.json(result, { status: result.success ? 200 : 422 })
}
