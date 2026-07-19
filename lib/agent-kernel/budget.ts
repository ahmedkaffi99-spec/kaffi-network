import type { RunBudget } from './types'
import type { Blackboard } from './blackboard'

/**
 * Vérifie le budget d'un run et retourne une raison lisible si dépassé,
 * ou null si on peut continuer. Utilisé pour garder la boucle
 * réflexion → décision bornée et prévisible (coût, latence, timeout Vercel)
 * plutôt que de laisser les agents boucler tant qu'ils "jugent nécessaire".
 */
export function budgetExceeded(budget: RunBudget, blackboard: Blackboard): string | null {
  if (blackboard.modelCallCount >= budget.maxModelCalls) {
    return `budget d'appels modèle atteint (${budget.maxModelCalls})`
  }
  if (Date.now() - budget.startedAt >= budget.deadlineMs) {
    return `deadline dépassée (${Math.round(budget.deadlineMs / 1000)}s)`
  }
  return null
}

export function createBudget(overrides: Partial<Omit<RunBudget, 'startedAt'>> = {}): RunBudget {
  return {
    maxIterations: 3,
    maxModelCalls: 12,
    deadlineMs: 260_000,
    ...overrides,
    startedAt: Date.now(),
  }
}
