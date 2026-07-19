import { routeCompletion, type AgentRole as ModelRole } from '@/lib/model-router'
import { budgetExceeded } from './budget'
import type { Blackboard } from './blackboard'
import type { RunBudget } from './types'

/**
 * Enveloppe routeCompletion() avec la comptabilité de budget du kernel.
 * Refuse d'appeler le modèle si le budget est déjà épuisé — c'est ce qui
 * rend la boucle réflexion → décision "bornée et prévisible" plutôt que de
 * compter uniquement sur un nombre d'itérations fixe.
 */
export async function callAgentModel(
  role: ModelRole,
  system: string,
  userMessage: string,
  maxTokens: number,
  blackboard: Blackboard,
  budget: RunBudget
): Promise<{ text: string; model_used: string }> {
  const exceeded = budgetExceeded(budget, blackboard)
  if (exceeded) {
    return { text: '', model_used: `skipped (${exceeded})` }
  }

  blackboard.recordModelCall()
  return routeCompletion(role, system, userMessage, maxTokens)
}
