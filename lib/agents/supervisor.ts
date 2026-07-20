import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { TierCombo } from '@/lib/types'
import { TIER_PICK_RANGE } from './odds-selector'

// Le Superviseur n'est plus un agent IA — l'utilisateur valide lui-même
// chaque palier depuis le dashboard (bouton Approuver/Rejeter sur les
// sessions en statut 'draft'). Ce module ne garde que les contrôles
// structurels objectifs (pas de jugement qualitatif ni d'appel modèle) :
// dernier filet de sécurité automatique avant que l'humain ne lise le post.

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
}

// Exporté séparément — réutilisé par app/api/sessions/[id]/apply-change pour
// valider un post réécrit via le chat, sans avoir besoin d'un TierCombo/
// Blackboard complet comme checkTierStructure ci-dessous.
export function checkForbiddenWords(text: string): string[] {
  const lower = text.toLowerCase()
  return FORBIDDEN_WORDS.filter(w => lower.includes(w))
}

/**
 * Contrôles structurels déterministes uniquement (plage de picks, doublons,
 * mots interdits). Ne juge ni le ton ni la cohérence du post — c'est
 * désormais à l'utilisateur de lire le post et d'approuver/rejeter depuis
 * le dashboard avant que la session ne devienne publiable.
 */
export function checkTierStructure(
  combo: TierCombo,
  writerOutput: string,
  blackboard: Blackboard
): SupervisorTierResult {
  const issues: string[] = []

  const { min, max } = TIER_PICK_RANGE[combo.tier]
  if (combo.picks.length < min || combo.picks.length > max) {
    issues.push(`Nombre de picks hors plage pour le palier ${combo.tier} : ${combo.picks.length} (attendu ${min}–${max})`)
  }

  const matchKeys = combo.picks.map(p => `${p.home_team}-${p.away_team}`)
  if (matchKeys.length !== new Set(matchKeys).size) {
    issues.push('Doublons : même match sélectionné plusieurs fois dans ce combiné')
  }

  const forbidden = checkForbiddenWords(writerOutput)
  if (forbidden.length) {
    issues.push(`Mots interdits dans le post : ${forbidden.join(', ')}`)
  }

  const result: SupervisorTierResult =
    issues.length > 0
      ? { verdict: 'revision_needed', issues, feedback: `Corrections obligatoires :\n${issues.map(i => `• ${i}`).join('\n')}` }
      : { verdict: 'approved', issues: [], feedback: 'Contrôles automatiques OK — en attente de ta validation manuelle.' }

  blackboard.post({
    from: 'supervisor',
    to: result.verdict === 'approved' ? 'all' : 'writer',
    type: result.verdict === 'approved' ? 'decision' : 'reflection',
    content: `Palier ${combo.tier} — ${result.feedback}`,
  })

  return result
}
