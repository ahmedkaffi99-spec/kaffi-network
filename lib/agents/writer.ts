import { callAgentModel, renderMission } from '@/lib/agent-kernel'
import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { RunBudget, AgentMission } from '@/lib/agent-kernel/types'
import type { TierCombo } from '@/lib/types'

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
  budget: RunBudget
): Promise<string> {
  const picksText = combo.picks
    .map((p, i) => `${i + 1}. ${p.home_team} vs ${p.away_team} (${p.competition})
   → ${p.bet_type} @ ${p.odds.toFixed(2)} (cote ${p.odds_source})
   Tendance : ${p.trend_label}`)
    .join('\n')

  const tierLabel = TIER_LABELS[combo.tier] ?? combo.tier
  const avgPickOdds = combo.picks.reduce((s, p) => s + p.odds, 0) / combo.picks.length

  const system = `${renderMission(MISSION)}

Kaffi Network est une chaîne Telegram de pronostics football premium.
Tu écris des posts engageants, confiants et professionnels en français.
Style : direct, percutant, sans fioritures. Format HTML Telegram UNIQUEMENT :
- Gras : <b>texte</b>  ·  Italique : <i>texte</i>
- Aucune autre balise. N'utilise JAMAIS la syntaxe Markdown (*, _, \`, [, ]).
- Ponctuation normale (., !, -, parenthèses) : jamais besoin de les échapper.
- Seuls les caractères & < > doivent être évités tels quels dans le texte libre (utilise "et" plutôt que "&" par exemple).`

  const userMessage = `Écris le post Telegram pour le combiné ${tierLabel} du ${date} :

${picksText}

Cote combinée : ${combo.combined_odds.toFixed(2)} (${combo.picks.length} matchs, cote moyenne par match ${avgPickOdds.toFixed(2)})

Structure du post :
1. Accroche percutante (1 ligne), mentionne le palier "${tierLabel}" — le risque du palier se juge à la cote MOYENNE PAR MATCH (${avgPickOdds.toFixed(2)}), pas à la cote combinée (qui est grosse pour les 3 paliers vu le nombre de matchs) : prudent = cote par match basse/tendance forte, audacieux = cote par match plus haute/plus incertaine
2. Chaque pick avec emoji numéroté (1️⃣ 2️⃣ etc.), match en gras, type de pari, cote, tendance courte
3. Cote combinée mise en valeur, en rappelant que ${combo.picks.length} résultats doivent tous se réaliser
4. CTA discret avec lien affilié : ${process.env.AFFILIATE_LINK ?? ''}
5. Disclaimer clair sur le pari responsable, proportionné à la cote moyenne par match — plus appuyé si le palier est audacieux

Réponds UNIQUEMENT avec le texte du post, prêt à envoyer.`

  const { text } = await callAgentModel('writer', system, userMessage, 800, blackboard, budget)

  blackboard.post({ from: 'writer', type: 'action', content: `Post Telegram "${tierLabel}" rédigé (${text.length} caractères).` })

  return text
}
