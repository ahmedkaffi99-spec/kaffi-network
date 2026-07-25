import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { proxyToBackend } from '@/lib/tools/backend-proxy'

// Publication = capture réelle du coupon misé sur 1xBet envoyée par
// l'utilisateur, relayée telle quelle (multipart) vers
// backend/routers/publish.py — voir ce fichier pour la logique réelle
// (upload Storage, envoi Telegram, garde-fous anti-doublon).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  // fetch() fixe automatiquement le Content-Type multipart/form-data avec
  // la bonne boundary quand le body est une instance FormData.
  const res = await proxyToBackend(`/api/publish/${sessionId}`, { method: 'POST', body: formData })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
