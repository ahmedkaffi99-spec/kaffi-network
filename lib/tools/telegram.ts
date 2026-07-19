import type { PickCandidate, Tier } from '@/lib/types'

const TIER_LABELS: Record<Tier, string> = {
  prudent: 'Prudent',
  equilibre: 'Équilibré',
  audacieux: 'Audacieux',
}

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

// Telegram "HTML" parse_mode ne réserve que & < > — contrairement à
// MarkdownV2 (~20 caractères réservés dont le point, très fréquent en
// français), ce qui le rend beaucoup plus fiable pour du texte généré par
// un LLM (le Rédacteur) qui n'échappe pas toujours parfaitement.
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formatCombinePost(picks: PickCandidate[], combinedOdds: number): string {
  const n = picks.length
  const lines: string[] = []

  lines.push(`🎫 <b>Combiné du jour — ${n} match${n > 1 ? 's' : ''} à tendance</b>`)
  lines.push('')

  picks.forEach((pick, i) => {
    const num = NUMBER_EMOJIS[i] ?? `${i + 1}.`
    const match = escapeHtml(`${pick.home_team} - ${pick.away_team}`)
    const bet = escapeHtml(pick.bet_type)
    const odds = pick.odds.toFixed(2)
    const trend = escapeHtml(pick.trend_label)
    lines.push(`${num} <b>${match}</b> → ${bet} (cote ${odds})`)
    lines.push(`   💡 <i>${trend}</i>`)
  })

  lines.push('')
  lines.push(`<b>Cote combinée : ${combinedOdds.toFixed(2)}</b>`)
  lines.push('')
  lines.push(`👉 Place ce combiné ici : ${escapeHtml(process.env.AFFILIATE_LINK ?? '')}`)
  lines.push('')
  lines.push(`⚠️ <i>Plus un combiné a de matchs, plus le risque augmente. Aucune prédiction sportive n'est garantie.</i>`)

  return lines.join('\n')
}

export async function sendMessage(text: string, replyToMessageId?: string): Promise<string> {
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
      parse_mode: 'HTML',
      ...(replyToMessageId ? { reply_to_message_id: Number(replyToMessageId) } : {}),
    }),
  })

  if (!res.ok) throw new Error(`Telegram sendMessage ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return String(data.result.message_id)
}

export interface ResultAnnouncementParams {
  tier: Tier
  date: string
  comboResult: 'win' | 'loss' | 'void'
  wins: number
  total: number
  combinedOdds: number | null
}

/** Message factuel — pas de LLM ici, l'annonce d'un résultat ne doit rien "interpréter". */
export function formatResultAnnouncement(params: ResultAnnouncementParams): string {
  const { tier, date, comboResult, wins, total, combinedOdds } = params
  const tierLabel = TIER_LABELS[tier] ?? tier
  const dateLabel = new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const icon = comboResult === 'win' ? '✅' : comboResult === 'loss' ? '❌' : '➖'
  const verdict = comboResult === 'win' ? 'GAGNÉ' : comboResult === 'loss' ? 'PERDU' : 'ANNULÉ'

  const lines = [
    `${icon} <b>Résultat — Combiné ${tierLabel} du ${dateLabel}</b>`,
    '',
    `${wins}/${total} picks corrects`,
  ]
  if (combinedOdds != null) lines.push(`Cote visée : ${combinedOdds.toFixed(2)}`)
  lines.push('', `<b>${verdict}</b>`)

  return lines.join('\n')
}

export async function sendPhoto(imageBuffer: Buffer, caption: string): Promise<string> {
  const channelId = process.env.TELEGRAM_CHANNEL_ID
  if (!process.env.TELEGRAM_BOT_TOKEN || !channelId) {
    throw new Error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHANNEL_ID manquant')
  }

  const form = new FormData()
  form.append('chat_id', channelId)
  form.append('caption', caption)
  form.append('parse_mode', 'HTML')
  form.append('photo', new Blob([imageBuffer as unknown as ArrayBuffer], { type: 'image/png' }), 'kombine.png')

  const res = await fetch(`${TELEGRAM_API}/sendPhoto`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Telegram sendPhoto ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return String(data.result.message_id)
}
