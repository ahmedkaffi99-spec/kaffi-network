import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { proxyToBackend } from '@/lib/tools/backend-proxy'

// Discussion ad-hoc sur UNE session déjà produite, relayée vers
// backend/routers/sessions.py:chat (voir aussi apply-change ci-dessous).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const res = await proxyToBackend(`/api/sessions/${id}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
