import { parseAgentJSON, callAgentModel, renderMission } from '@/lib/agent-kernel'
import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { RunBudget, AgentMission } from '@/lib/agent-kernel/types'
import type { TierCombo } from '@/lib/types'
import { TIER_PICK_RANGE } from './odds-selector'

const MISSION: AgentMission = {
  role: 'supervisor',
  label: 'le Superviseur',
  responsibility:
    "valider strictement, pour chaque palier, le combiné composé par le Sélecteur de cotes ET le post rédigé par le Rédacteur avant toute publication — dernier garde-fou du crew.",
  doesNot: [
    'Ne compose ni ne modifie aucun combiné lui-même — renvoie un feedback au Rédacteur pour réécriture.',
    "Ne choisit aucune cote — délégué au Sélecteur de cotes.",
    'Ne publie jamais rien directement.',
  ],
}

const FORBIDDEN_WORDS = [
  // Promesses de gain non tenables
  'garanti', 'garantine', 'sûr à 100', '100% sûr', 'certain à 100', 'infaillible', 'sans risque', "gagné d'avance", 'coup sûr',
  // Langage familier / références inappropriées à la mort — jamais dans un contexte de paris
  'suicide', 'roulette russe', 'mortel', 'de ouf',
]

export interface SupervisorTierResult {
  verdict: 'approved' | 'revision_needed'
  issues: string[]
  feedback?: string
  lesson_for_memory?: string
}

function deterministicChecks(combo: TierCombo, writerOutput: string): string[] {
  const issues: string[] = []

  const { min, max } = TIER_PICK_RANGE[combo.tier]
  if (combo.picks.length < min || combo.picks.length > max) {
    issues.push(`Nombre de picks hors plage pour le palier ${combo.tier} : ${combo.picks.length} (attendu ${min}–${max})`)
  }

  const matchKeys = combo.picks.map(p => `${p.home_team}-${p.away_team}`)
  if (matchKeys.length !== new Set(matchKeys).size) {
    issues.push('Doublons : même match sélectionné plusieurs fois dans ce combiné')
  }

  const writerLower = writerOutput.toLowerCase()
  const forbidden = FORBIDDEN_WORDS.filter(w => writerLower.includes(w))
  if (forbidden.length) {
    issues.push(`Mots interdits dans le post : ${forbidden.join(', ')}`)
  }

  return issues
}

/**
 * Valide un palier (combo + post déjà rédigé) — dernier garde-fou avant
 * publication. Contrôles déterministes d'abord (structure, mots interdits) ;
 * si aucun problème structurel, une seule passe qualitative LLM.
 */
export async function reviewTier(
  combo: TierCombo,
  writerOutput: string,
  blackboard: Blackboard,
  budget: RunBudget
): Promise<SupervisorTierResult> {
  const structuralIssues = deterministicChecks(combo, writerOutput)

  if (structuralIssues.length > 0) {
    const feedback = `Corrections obligatoires :\n${structuralIssues.map(i => `• ${i}`).join('\n')}`
    blackboard.post({ from: 'supervisor', to: 'writer', type: 'reflection', content: `Palier ${combo.tier} — ${feedback}` })
    return { verdict: 'revision_needed', issues: structuralIssues, feedback }
  }

  const picksText = combo.picks
    .map(p => `${p.home_team} vs ${p.away_team} (${p.competition}) → ${p.bet_type} @ ${p.odds.toFixed(2)} [${p.odds_source}]`)
    .join('\n')

  const system = `${renderMission(MISSION)}

VÉRIFICATIONS OBLIGATOIRES SUR LE POST REÇU :
1. Diversité des compétitions (pas 3 picks dans la même ligue si le combiné en compte plus)
2. Cohérence entre le texte du post et les picks du combiné (aucun pick omis, ajouté ou déformé)
3. Absence de contradictions (ex: over ET under sur le même match)
4. Aucune promesse de gain déguisée qui contournerait l'esprit de l'interdiction "garanti/sûr à 100%/infaillible" même reformulée autrement
5. Ton proportionné au risque : prudent (peu de picks, cotes basses) doit se lire comme la sélection la plus fiable, audacieux (plus de picks et/ou cotes plus hautes) comme la plus incertaine mais la plus payante — le post ne doit ni maquiller le risque d'audacieux, ni sous-vendre la fiabilité de prudent

Sois STRICT : un doute = revision_needed.
Réponds UNIQUEMENT avec du JSON valide.`

  const userMessage = `Valide le palier ${combo.tier} (cote combinée ${combo.combined_odds.toFixed(2)}) :

COMBINÉ :
${picksText}

POST RÉDIGÉ :
${writerOutput}

JSON attendu :
{
  "verdict": "approved" | "revision_needed",
  "issues": ["problèmes si revision_needed"],
  "feedback": "commentaire bref",
  "lesson_for_memory": "optionnel — une leçon durable à retenir pour les prochains runs si tu observes un pattern notable (sinon omets ce champ)"
}`

  const { text: raw } = await callAgentModel('supervisor', system, userMessage, 512, blackboard, budget)

  // Fail-closed : une réponse illisible ne doit JAMAIS valider le palier par
  // défaut — c'est le dernier garde-fou avant publication automatique.
  const fallback: SupervisorTierResult = {
    verdict: 'revision_needed',
    issues: ['Réponse du superviseur illisible (JSON invalide) — validation impossible'],
    feedback: "Le superviseur n'a pas pu être validé automatiquement, nouvelle tentative requise.",
  }
  const result = parseAgentJSON<SupervisorTierResult>(raw, fallback)

  blackboard.post({
    from: 'supervisor',
    to: result.verdict === 'approved' ? 'all' : 'writer',
    type: result.verdict === 'approved' ? 'decision' : 'reflection',
    content: `Palier ${combo.tier} — ${result.feedback ?? (result.verdict === 'approved' ? 'Approuvé.' : 'Révision demandée.')}`,
  })

  return result
}
