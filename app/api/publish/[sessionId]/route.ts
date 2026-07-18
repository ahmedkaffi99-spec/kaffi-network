import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { publishToTelegram } from '@/lib/telegram'
import type { PronosticSession, Pick } from '@/lib/types'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { data: session } = await supabase
    .from('pronostic_sessions')
    .select('*, picks(*)')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })

  if (session.status !== 'approved') {
    return NextResponse.json(
      { error: 'La session doit être approuvée avant publication' },
      { status: 400 }
    )
  }

  if (!session.picks || session.picks.length === 0) {
    return NextResponse.json({ error: 'Aucun pick dans cette session' }, { status: 400 })
  }

  try {
    const typedSession = session as PronosticSession
    const picks = session.picks as Pick[]

    const telegramMsgId = await publishToTelegram(typedSession, picks)

    await supabase
      .from('pronostic_sessions')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        telegram_msg_id: telegramMsgId,
      })
      .eq('id', sessionId)

    return NextResponse.json({ success: true, telegram_message_id: telegramMsgId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur Telegram'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
