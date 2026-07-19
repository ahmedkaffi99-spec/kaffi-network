import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateTicketImage } from '@/lib/tools/image-generator'
import { sendPhoto } from '@/lib/tools/telegram'
import { shortenBetType } from '@/lib/tools/display-format'
import type { PickCandidate } from '@/lib/types'

// Endpoint temporaire — génère un combiné avec des données INVENTÉES pour
// prévisualiser le format visuel du post sur Telegram, sans dépendre du
// pipeline réel (API-Football, cotes, etc.). Marqué "EXEMPLE" dans le post
// pour ne jamais induire les abonnés en erreur sur une vraie prédiction.
const FAKE_PICKS: PickCandidate[] = [
  { competition: 'Premier League', home_team: 'Arsenal', away_team: 'Chelsea', match_datetime: new Date().toISOString(), bet_type: 'Plus de 2.5 buts', odds: 1.65, trend_label: 'Arsenal: 12/15 matchs sous 2.5 buts', trend_pct: 87, sample_size: 15 },
  { competition: 'La Liga', home_team: 'Real Madrid', away_team: 'Sevilla', match_datetime: new Date().toISOString(), bet_type: 'Victoire domicile', odds: 1.55, trend_label: 'Real Madrid: 13/15 victoires à domicile', trend_pct: 86, sample_size: 15 },
  { competition: 'Serie A', home_team: 'Inter Milan', away_team: 'Torino', match_datetime: new Date().toISOString(), bet_type: 'BTTS Non', odds: 1.72, trend_label: 'Torino: 11/13 matchs sans marquer', trend_pct: 84, sample_size: 13 },
  { competition: 'Bundesliga', home_team: 'Bayern Munich', away_team: 'Mainz', match_datetime: new Date().toISOString(), bet_type: 'Plus de 2.5 buts', odds: 1.48, trend_label: 'Bayern: 14/15 matchs plus de 2.5 buts', trend_pct: 93, sample_size: 15 },
  { competition: 'Ligue 1', home_team: 'PSG', away_team: 'Nantes', match_datetime: new Date().toISOString(), bet_type: 'Victoire domicile', odds: 1.42, trend_label: 'PSG: 12/14 victoires à domicile', trend_pct: 85, sample_size: 14 },
]

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  try {
    const combinedOdds = FAKE_PICKS.reduce((acc, p) => acc * p.odds, 1)
    const imageBuffer = await generateTicketImage(FAKE_PICKS, combinedOdds, new Date().toISOString())

    const caption = [
      '🧪 <b>EXEMPLE — pas un vrai pronostic</b>',
      '',
      '🎫 <b>Aperçu du format Combiné Kaffi Network</b>',
      '',
      ...FAKE_PICKS.map((p, i) => `${i + 1}. <b>${p.home_team} VS ${p.away_team}</b> → ${shortenBetType(p.bet_type)} (cote ${p.odds.toFixed(2)})\n   💡 <i>${p.trend_label}</i>`),
      '',
      `<b>Cote combinée : ${combinedOdds.toFixed(2)}</b>`,
      '',
      '⚠️ <i>Ceci est un exemple avec des données inventées, uniquement pour prévisualiser le format visuel.</i>',
    ].join('\n')

    const telegramMsgId = await sendPhoto(imageBuffer, caption)

    return NextResponse.json({ success: true, telegram_msg_id: telegramMsgId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur Telegram'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
