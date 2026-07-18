import type { PronosticSession, Pick } from './types'

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

export function formatTelegramMessage(session: PronosticSession, picks: Pick[]): string {
  const affiliateLink = process.env.AFFILIATE_LINK ?? ''
  const n = picks.length
  const lines: string[] = []

  lines.push(`🎫 *Combiné du jour — ${n} match${n > 1 ? 's' : ''} à tendance*`)
  lines.push('')

  picks.forEach((pick, i) => {
    const num = NUMBER_EMOJIS[i] ?? `${i + 1}\\.`
    const match = escapeMarkdownV2(`${pick.home_team} - ${pick.away_team}`)
    const bet = escapeMarkdownV2(pick.bet_type)
    const odds = escapeMarkdownV2(pick.odds.toFixed(2))
    const trend = escapeMarkdownV2(pick.trend_label)

    lines.push(`${num} *${match}* → ${bet} \\(cote ${odds}\\)`)
    lines.push(`   💡 _${trend}_`)
  })

  lines.push('')
  lines.push(`*Cote combinée : ${escapeMarkdownV2(session.combined_odds?.toFixed(2) ?? 'N/A')}*`)
  lines.push('')
  lines.push(`👉 Place ce combiné ici : ${affiliateLink}`)
  lines.push('')
  lines.push(
    `⚠️ _Plus un combiné a de matchs, plus le risque augmente\\. Aucune prédiction sportive n'est garantie\\._`
  )

  return lines.join('\n')
}

export async function publishToTelegram(
  session: PronosticSession,
  picks: Pick[]
): Promise<string> {
  const channelId = process.env.TELEGRAM_CHANNEL_ID

  if (!process.env.TELEGRAM_BOT_TOKEN || !channelId) {
    throw new Error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHANNEL_ID manquant')
  }

  const message = formatTelegramMessage(session, picks)

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: channelId,
      text: message,
      parse_mode: 'MarkdownV2',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram API ${res.status}: ${body}`)
  }

  const data = await res.json()
  return String(data.result.message_id)
}
