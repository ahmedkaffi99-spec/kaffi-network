import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { proxyToBackend } from '@/lib/tools/backend-proxy'

export const maxDuration = 300

// Relaie vers le backend Python local (backend/routers/generate.py) — la
// logique du pipeline (Planificateur → Analyste → Sélecteur de cotes →
// Rédacteur → Superviseur) tourne désormais côté Python, voir
// backend/orchestrator.py. Cette route ne fait plus que vérifier la
// session utilisateur puis relayer.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const res = await proxyToBackend('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
