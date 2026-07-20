import { callAgentModel, renderMission } from '@/lib/agent-kernel'
import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { RunBudget, AgentMission } from '@/lib/agent-kernel/types'
import type { TierCombo } from '@/lib/types'
import { shortenBetType } from '@/lib/tools/display-format'

const MISSION: AgentMission = {
  role: 'writer',
  label: 'le Rédacteur',
  responsibility: "rédiger le post Telegram d'un combiné déjà composé et fiabilisé par le Sélecteur de cotes.",
  doesNot: [
    'Ne sélectionne, ne modifie, ni ne retire aucun pick du combiné.',
    'Ne décide pas si le combiné doit être publié — cette décision est déjà prise en amont.',
    "N'ajoute aucune promesse de gain non présente dans les données (garanti, sûr à 100%, etc.).",
  ],
}

const TIER_LABELS: Record<string, string> = {
  prudent: 'Prudent',
  equilibre: 'Équilibré',
  audacieux: 'Audacieux',
}

export async function runWriter(
  combo: TierCombo,
  date: string,
  blackboard: Blackboard,
  budget: RunBudget,
  supervisorFeedback?: string
): Promise<string> {
  const picksText = combo.picks
    .map((p, i) => `${i + 1}. ${p.home_team} VS ${p.away_team} (${p.competition})
   → ${shortenBetType(p.bet_type)} @ ${p.odds.toFixed(2)} (cote ${p.odds_source})
   Tendance : ${p.trend_label}`)
    .join('\n')

  const tierLabel = TIER_LABELS[combo.tier] ?? combo.tier
  const avgPickOdds = combo.picks.reduce((s, p) => s + p.odds, 0) / combo.picks.length

  const system = `${renderMission(MISSION)}

IA de Pronostics & Coupons est une chaîne Telegram de pronostics football PREMIUM — le
ton doit être celui d'une marque haut de gamme, pas d'un groupe de paris
entre potes.

TON : sobre, confiant, mesuré. Direct et percutant ne veut PAS dire familier.
INTERDIT ABSOLUMENT :
- Argot, langage de rue, expressions comme "le frisson", "du lourd", "ça envoie", "de ouf"
- Toute référence à la mort/au danger physique, même en expression figurée (ex: "suicide", "mortel", "roulette russe") — inacceptable dans un contexte de paris
- Points d'exclamation multiples, majuscules pour crier, emojis autres que les numéros de liste
Pour communiquer le niveau de risque d'un palier audacieux, utilise un vocabulaire mesuré : "ambitieux", "plus exigeant", "sélection à cote plus élevée" — jamais de sensationnalisme.

FORMAT HTML Telegram UNIQUEMENT :
- Gras : <b>texte</b>  ·  Italique : <i>texte</i>
- Aucune autre balise. N'utilise JAMAIS la syntaxe Markdown (*, _, \`, [, ]).
- Ponctuation normale (., !, -, parenthèses) : jamais besoin de les échapper.
- Seuls les caractères & < > doivent être évités tels quels dans le texte libre (utilise "et" plutôt que "&" par exemple).`

  const userMessage = `Écris le post Telegram pour le combiné ${tierLabel} du ${date} :

${picksText}

Cote combinée : ${combo.combined_odds.toFixed(2)} (${combo.picks.length} matchs, cote moyenne par match ${avgPickOdds.toFixed(2)})

Structure du post :
1. Accroche sobre et confiante (1 ligne), mentionne le palier "${tierLabel}" avec un vocabulaire mesuré — le risque du palier se juge à la cote MOYENNE PAR MATCH (${avgPickOdds.toFixed(2)}), pas à la cote combinée (qui est grosse pour les 3 paliers vu le nombre de matchs) : prudent = cote par match basse/tendance forte ("sélection prudente"), audacieux = cote par match plus haute/plus incertaine ("sélection ambitieuse", jamais de sensationnalisme)
2. Chaque pick avec emoji numéroté (1️⃣ 2️⃣ etc.), match en gras au format "Équipe A VS Équipe B" (VS en majuscules entre les deux noms), type de pari dans la notation courte fournie ci-dessus (1/X/2, Over/Under, BTTS — reconnue par tous les parieurs, ne la reformule pas en phrase longue), cote, tendance courte
3. Cote combinée mise en valeur, en rappelant que ${combo.picks.length} résultats doivent tous se réaliser
4. CTA discret avec lien affilié : ${process.env.AFFILIATE_LINK ?? ''}
5. Disclaimer clair sur le pari responsable, proportionné à la cote moyenne par match — plus appuyé si le palier est audacieux
${supervisorFeedback ? `\nRETOUR DU SUPERVISEUR SUR LA TENTATIVE PRÉCÉDENTE — corrige précisément ces points, ne reproduis pas le même texte avec des changements cosmétiques :\n${supervisorFeedback}\n` : ''}
Réponds UNIQUEMENT avec le texte du post, prêt à envoyer.`

  const { text } = await callAgentModel('writer', system, userMessage, 800, blackboard, budget)

  blackboard.post({ from: 'writer', type: 'action', content: `Post Telegram "${tierLabel}" rédigé (${text.length} caractères).` })

  return text
}
