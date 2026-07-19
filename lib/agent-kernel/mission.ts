import type { AgentMission } from './types'

/**
 * Rend le bloc "mission" d'un agent — responsabilité unique + bornes
 * explicites — de façon uniforme, injecté en tête de chaque system prompt.
 * Garantit que chaque agent connaît sa responsabilité ET ce qui ne relève
 * pas de lui (délégué à un autre agent du crew).
 */
export function renderMission(mission: AgentMission): string {
  const bounds = mission.doesNot.map(d => `- ${d}`).join('\n')
  return `Tu es ${mission.label} (rôle: ${mission.role}).
Ta SEULE responsabilité : ${mission.responsibility}

Ce qui N'EST PAS de ta responsabilité (délégué à un autre agent du crew) :
${bounds}`
}
