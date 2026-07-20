import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminSupabase } from '@/lib/supabase/admin'
import { sendPhoto } from '@/lib/tools/telegram'
import { checkDuplicates, savePublishedMatches } from '@/lib/tools/duplicate-checker'
import type { PronosticSession, Pick, PickCandidate } from '@/lib/types'

// Marge large pour une capture d'écran de téléphone (souvent 3-6 Mo en HD).
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Publication = capture réelle du coupon misé sur 1xBet envoyée par
// l'utilisateur, pas un ticket généré automatiquement — voir lib/orchestrator.ts
// (s'arrête à 'approved') et la discussion produit : l'IA ne fabrique jamais
// de faux "Mise / Gains potentiels / Statut : Accepté", seul un vrai pari
// réellement placé peut afficher ces informations.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { data: session } = await supabase
    .from('pronostic_sessions')
    .select('*, picks(*)')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  if (session.status !== 'approved') {
    return NextResponse.json({ error: 'La session doit être approuvée avant publication' }, { status: 400 })
  }
  if (!session.writer_output) {
    return NextResponse.json({ error: 'Aucun texte de post rédigé pour cette session' }, { status: 400 })
  }

  const typedSession = session as PronosticSession
  const writerOutput = session.writer_output as string
  const picks = (session.picks ?? []) as Pick[]
  if (!picks.length) return NextResponse.json({ error: 'Aucun pick dans cette session' }, { status: 400 })

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'Capture manquante — envoie une image du coupon 1xBet réellement misé.' },
      { status: 400 }
    )
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Format non supporté — envoie une image JPEG, PNG ou WebP.' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Image trop grande (max 10 Mo).' }, { status: 400 })
  }

  try {
    const picksAsCandidate: PickCandidate[] = picks.map(p => ({
      competition: p.competition,
      home_team: p.home_team,
      away_team: p.away_team,
      match_datetime: p.match_datetime ?? new Date().toISOString(),
      bet_type: p.bet_type,
      odds: p.odds,
      trend_label: p.trend_label,
      trend_pct: p.trend_pct,
      sample_size: p.sample_size,
    }))

    // Les picks sont volontairement partagés entre paliers (même jour) — ce
    // contrôle bloque seulement un match déjà réellement publié pour CE
    // palier, pas la présence normale d'un match dans plusieurs paliers.
    const { ok, duplicates } = await checkDuplicates(picksAsCandidate, typedSession.tier)
    if (!ok) {
      return NextResponse.json({ error: `Picks déjà publiés : ${duplicates.join(', ')}` }, { status: 409 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${sessionId}-${Date.now()}.${ext}`

    // Bucket privé — ces captures peuvent révéler un solde de compte réel,
    // jamais rendues publiques (lib/supabase/admin.ts bypasse RLS pour cet
    // upload serveur, mais aucune politique publique n'existe sur ce bucket).
    const { error: uploadError } = await adminSupabase.storage
      .from('manual-tickets')
      .upload(path, bytes, { contentType: file.type, upsert: false })
    if (uploadError) throw new Error(`Échec upload capture : ${uploadError.message}`)

    const telegramMsgId = await sendPhoto(bytes, writerOutput)

    await adminSupabase
      .from('pronostic_sessions')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        telegram_msg_id: telegramMsgId,
        manual_ticket_path: path,
      })
      .eq('id', sessionId)

    await savePublishedMatches(picksAsCandidate, sessionId, typedSession.tier)

    return NextResponse.json({ success: true, telegram_message_id: telegramMsgId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur publication'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
