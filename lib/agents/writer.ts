import Anthropic from '@anthropic-ai/sdk'
import type { AnalystOutput } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function runWriter(
  analystOutput: AnalystOutput,
  date: string
): Promise<string> {
  const picks = analystOutput.picks_retenus
  const combinedOdds = picks.reduce((acc, p) => acc * p.odds, 1)

  const picksText = picks
    .map((p, i) => `${i + 1}. ${p.home_team} vs ${p.away_team} (${p.competition})
   → ${p.bet_type} @ ${p.odds.toFixed(2)}
   Tendance : ${p.trend_pct}% sur ${p.sample_size} matchs`)
    .join('\n')

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    system: `Tu es le rédacteur de Kaffi Network, une chaîne Telegram de pronostics football premium.
Tu écris des posts engageants, confiants et professionnels en français.
Style : direct, percutant, sans fioritures. Utilise MarkdownV2 Telegram.
Règles MarkdownV2 : échappe ces caractères avec \\ : _ * [ ] ( ) ~ \` > # + - = | { } . !`,
    messages: [
      {
        role: 'user',
        content: `Écris le post Telegram pour le combiné du ${date} :

${picksText}

Cote combinée : ${combinedOdds.toFixed(2)}

Structure du post :
1. Accroche percutante (1 ligne)
2. Chaque pick avec emoji numéroté (1️⃣ 2️⃣ etc.), match en gras, type de pari, cote, tendance courte
3. Cote combinée mise en valeur
4. CTA discret avec lien affilié : ${process.env.AFFILIATE_LINK ?? ''}
5. Disclaimer court sur le pari responsable

Réponds UNIQUEMENT avec le texte du post, prêt à envoyer.`,
      },
    ],
  })

  return message.content[0].type === 'text' ? message.content[0].text.trim() : ''
}
