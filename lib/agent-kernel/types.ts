// Agent Kernel — types génériques du framework multi-agents.
// Un "crew" (ex: le pipeline pronostics foot) instancie ces primitives ;
// le kernel lui-même ne connaît rien du domaine métier.

export type AgentRole = string

export interface AgentMission {
  role: AgentRole
  label: string
  /** Une seule phrase : la responsabilité unique de l'agent. */
  responsibility: string
  /** Bornes explicites — ce que l'agent NE fait PAS (délégué à un autre agent). */
  doesNot: string[]
}

export type BlackboardMessageType =
  | 'observation' // perception : ce que l'agent a constaté (données, contexte)
  | 'plan'        // planification : ce que l'agent compte faire
  | 'decision'    // décision : verdict pris (approuvé/rejeté/révision)
  | 'reflection'  // réflexion : auto-critique ou validation d'un autre agent
  | 'action'      // exécution : effet de bord déclenché (appel outil, publication)
  | 'result'      // résultat final d'une étape

export interface BlackboardMessage {
  from: AgentRole
  to?: AgentRole | 'all'
  type: BlackboardMessageType
  content: string
  createdAt: string
}

export interface RunBudget {
  /** Nombre max d'itérations de la boucle de révision (analyste ⇄ superviseur). */
  maxIterations: number
  /** Nombre max d'appels modèle (routeCompletion) sur tout le run. */
  maxModelCalls: number
  /** Budget de temps total en ms, mesuré depuis startedAt. */
  deadlineMs: number
  startedAt: number
}

export interface MemoryTiers {
  /** Court terme : contexte de mémoire déjà rendu (résumé des messages pertinents du run en cours). */
  shortTerm: string
  /** Moyen terme : fenêtre glissante en lecture seule (ex: performance des 30 derniers jours). */
  mediumTerm: string
  /** Long terme : leçons distillées persistées entre les runs. */
  longTerm: string
}
