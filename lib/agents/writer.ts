import { routeCompletion } from '@/lib/model-router'
import type { AnalystOutput } from '@/lib/types'

export async function runWriter(
  analystOutput: AnalystOutput,
  date: string
): Promise<string> {
  const picks = analystOutput.picks_retenus
  const combinedOdds = picks.reduce((acc, p) => acc * p.odds, 1)

  const picksText = picks
    .map((p, i) => `${i + 1}. ${p.home_team} vs ${p.away_team} (${p.competition})
   → ${p.bet_type} @ ${p.odds.toFixed(2)}
   Tendance : ${p.trend_label}`)
    .join('\n')

  const system = `Tu es le rédacteur de Kaffi Network, une chaîne Telegram de pronostics football premium.
Tu écris des posts engageants, confiants et professionnels en français.
Style : direct, percutant, sans fioritures. Utilise MarkdownV2 Telegram.
Règles MarkdownV2 : échappe ces caractères avec \\ : _ * [ ] ( ) ~ \` > # + - = | { } . !`

  const userMessage = `Écris le post Telegram pour le combiné du ${date} :

${picksText}

Cote combinée : ${combinedOdds.toFixed(2)}

Structure du post :
1. Accroche percutante (1 ligne)
2. Chaque pick avec emoji numéroté (1️⃣ 2️⃣ etc.), match en gras, type de pari, cote, tendance courte
3. Cote combinée mise en valeur
4. CTA discret avec lien affilié : ${process.env.AFFILIATE_LINK ?? ''}
5. Disclaimer court sur le pari responsable

Réponds UNIQUEMENT avec le texte du post, prêt à envoyer.`

  const { text } = await routeCompletion('writer', system, userMessage, 800)
  return text
}
