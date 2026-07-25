import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { proxyToBackend } from '@/lib/tools/backend-proxy'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const res = await proxyToBackend(`/api/sessions/${id}/approve`, { method: 'POST' })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
