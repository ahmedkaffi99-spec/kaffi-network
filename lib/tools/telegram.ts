import type { PickCandidate } from '@/lib/types'

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

function escapeV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

export function formatCombinePost(picks: PickCandidate[], combinedOdds: number): string {
  const n = picks.length
  const lines: string[] = []

  lines.push(`🎫 *Combiné du jour — ${n} match${n > 1 ? 's' : ''} à tendance*`)
  lines.push('')

  picks.forEach((pick, i) => {
    const num = NUMBER_EMOJIS[i] ?? `${i + 1}\\.`
    const match = escapeV2(`${pick.home_team} - ${pick.away_team}`)
    const bet = escapeV2(pick.bet_type)
    const odds = escapeV2(pick.odds.toFixed(2))
    const trend = escapeV2(pick.trend_label)
    lines.push(`${num} *${match}* → ${bet} \\(cote ${odds}\\)`)
    lines.push(`   💡 _${trend}_`)
  })

  lines.push('')
  lines.push(`*Cote combinée : ${escapeV2(combinedOdds.toFixed(2))}*`)
  lines.push('')
  lines.push(`👉 Place ce combiné ici : ${process.env.AFFILIATE_LINK ?? ''}`)
  lines.push('')
  lines.push(
    `⚠️ _Plus un combiné a de matchs, plus le risque augmente\\. Aucune prédiction sportive n'est garantie\\._`
  )

  return lines.join('\n')
}

export async function sendMessage(text: string): Promise<string> {
  const channelId = process.env.TELEGRAM_CHANNEL_ID
  if (!process.env.TELEGRAM_BOT_TOKEN || !channelId) {
    throw new Error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHANNEL_ID manquant')
  }

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: channelId,
      text,
      parse_mode: 'MarkdownV2',
    }),
  })

  if (!res.ok) throw new Error(`Telegram sendMessage ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return String(data.result.message_id)
}

export async function sendPhoto(imageBuffer: Buffer, caption: string): Promise<string> {
  const channelId = process.env.TELEGRAM_CHANNEL_ID
  if (!process.env.TELEGRAM_BOT_TOKEN || !channelId) {
    throw new Error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHANNEL_ID manquant')
  }

  const form = new FormData()
  form.append('chat_id', channelId)
  form.append('caption', caption)
  form.append('parse_mode', 'MarkdownV2')
  form.append('photo', new Blob([imageBuffer as unknown as ArrayBuffer], { type: 'image/png' }), 'kombine.png')

  const res = await fetch(`${TELEGRAM_API}/sendPhoto`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Telegram sendPhoto ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return String(data.result.message_id)
}
