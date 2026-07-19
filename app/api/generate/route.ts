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

  const result = await runPipeline(date)
  return NextResponse.json(result, { status: result.success ? 200 : 422 })
}
