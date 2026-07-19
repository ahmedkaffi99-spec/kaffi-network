import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { formatCombinePost, sendPhoto } from '@/lib/tools/telegram'
import { generateTicketImage } from '@/lib/tools/image-generator'
import { savePublishedMatches } from '@/lib/tools/duplicate-checker'
import type { PronosticSession, Pick, PickCandidate } from '@/lib/types'

export async function POST(
  _req: Request,
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

  const picks = (session.picks ?? []) as Pick[]
  if (!picks.length) return NextResponse.json({ error: 'Aucun pick dans cette session' }, { status: 400 })

  try {
    const typedSession = session as PronosticSession
    const combinedOdds = picks.reduce((acc, p) => acc * p.odds, 1)

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

    const imageBuffer = await generateTicketImage(picksAsCandidate, combinedOdds, typedSession.date)
    const caption = formatCombinePost(picksAsCandidate, combinedOdds)
    const telegramMsgId = await sendPhoto(imageBuffer, caption)

    await supabase
      .from('pronostic_sessions')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        telegram_msg_id: telegramMsgId,
        combined_odds: Math.round(combinedOdds * 100) / 100,
      })
      .eq('id', sessionId)

    await savePublishedMatches(picksAsCandidate, sessionId)

    return NextResponse.json({ success: true, telegram_message_id: telegramMsgId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur Telegram'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
