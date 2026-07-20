import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkForbiddenWords } from '@/lib/agents/supervisor'
import { TIER_PICK_RANGE } from '@/lib/agents/odds-selector'
import type { Pick, Tier } from '@/lib/types'

const MAX_TEXT_LEN = 4000

// Applique un changement PROPOSÉ par le chat (app/api/sessions/[id]/chat) —
// jamais appliqué automatiquement, seulement quand l'utilisateur clique
// "Appliquer ce changement" dans components/SessionChat.tsx. C'est le bouton
// qui fait autorité : le chat ne fait que proposer, cette route exécute.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const type = body?.type

  const { data: session } = await supabase
    .from('pronostic_sessions')
    .select('*, picks(*)')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })

  // Une session déjà approuvée/publiée/rejetée est figée — un pick a pu être
  // réellement misé sur 1xBet entre-temps, la modifier après coup romprait
  // le lien avec ce qui a été réellement engagé.
  if (session.status !== 'draft') {
    return NextResponse.json(
      { error: 'Cette session n\'est plus modifiable (déjà approuvée, publiée ou rejetée).' },
      { status: 409 }
    )
  }

  if (type === 'rewrite_post') {
    const newText = typeof body?.new_text === 'string' ? body.new_text.trim() : ''
    if (!newText) return NextResponse.json({ error: 'Texte vide.' }, { status: 400 })
    if (newText.length > MAX_TEXT_LEN) return NextResponse.json({ error: 'Texte trop long.' }, { status: 400 })

    const forbidden = checkForbiddenWords(newText)
    if (forbidden.length) {
      return NextResponse.json(
        { error: `Ce texte contient des mots interdits (${forbidden.join(', ')}) — non appliqué.` },
        { status: 400 }
      )
    }

    const { error } = await supabase.from('pronostic_sessions').update({ writer_output: newText }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, note: 'Post mis à jour.' })
  }

  if (type === 'remove_pick') {
    const homeTeam = typeof body?.home_team === 'string' ? body.home_team.trim().toLowerCase() : ''
    const awayTeam = typeof body?.away_team === 'string' ? body.away_team.trim().toLowerCase() : ''
    const betType = typeof body?.bet_type === 'string' ? body.bet_type.trim().toLowerCase() : ''

    const picks = (session.picks ?? []) as Pick[]
    const activePicks = picks.filter(p => !p.was_rejected)

    const target = activePicks.find(
      p =>
        p.home_team.trim().toLowerCase() === homeTeam &&
        p.away_team.trim().toLowerCase() === awayTeam &&
        p.bet_type.trim().toLowerCase() === betType
    )

    if (!target) {
      return NextResponse.json({ error: 'Pick introuvable dans ce combiné.' }, { status: 404 })
    }

    const remaining = activePicks.filter(p => p.id !== target.id)
    const { min } = TIER_PICK_RANGE[session.tier as Tier]

    if (remaining.length < min) {
      return NextResponse.json(
        { error: `Impossible de retirer ce pick : il faut au moins ${min} picks pour un palier ${session.tier}, il n'en resterait que ${remaining.length}.` },
        { status: 400 }
      )
    }

    const { error: updatePickError } = await supabase
      .from('picks')
      .update({ was_rejected: true, rejection_reason: 'Retiré manuellement via le chat.' })
      .eq('id', target.id)
    if (updatePickError) return NextResponse.json({ error: updatePickError.message }, { status: 500 })

    const combinedOdds = Math.round(remaining.reduce((acc, p) => acc * p.odds, 1) * 100) / 100

    const { error: updateSessionError } = await supabase
      .from('pronostic_sessions')
      .update({ combined_odds: combinedOdds })
      .eq('id', id)
    if (updateSessionError) return NextResponse.json({ error: updateSessionError.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      note: 'Pick retiré, cote recalculée. Pense à demander au Rédacteur de réécrire le post si besoin — il n\'est pas mis à jour automatiquement.',
    })
  }

  return NextResponse.json({ error: 'Type de changement inconnu.' }, { status: 400 })
}
