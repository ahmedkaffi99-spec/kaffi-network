import { parseAgentJSON, callAgentModel, renderMission } from '@/lib/agent-kernel'
import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { RunBudget, AgentMission } from '@/lib/agent-kernel/types'
import type { PlannerOutput } from '@/lib/types'

const COMPETITIONS = [
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'Champions League', 'Europa League', 'Championship', 'Liga Portugal', 'Eredivisie',
  'Campeonato Brasileiro', 'Copa Libertadores', 'FIFA World Cup',
]

const MISSION: AgentMission = {
  role: 'planner',
  label: 'le Planificateur',
  responsibility:
    "fixer le plan du jour : quelles compétitions et quels types de paris prioriser, avant toute analyse de données.",
  doesNot: [
    'Ne sélectionne aucun pick — délégué à l\'Analyste.',
    'Ne consulte aucune donnée de match ou de cote — décide sur la base du calendrier et du jour de la semaine uniquement.',
    'Ne valide ni ne publie rien.',
  ],
}

export async function runPlanner(date: string, blackboard: Blackboard, budget: RunBudget): Promise<PlannerOutput> {
  const dayName = new Date(date).toLocaleDateString('fr-FR', { weekday: 'long' })

  const system = `${renderMission(MISSION)}

Tu analyses le calendrier football du jour et produis un plan JSON structuré.
Réponds UNIQUEMENT avec du JSON valide, sans markdown ni commentaire.`

  const userMessage = `Date : ${date} (${dayName})
Compétitions disponibles : ${COMPETITIONS.join(', ')}

Génère un plan JSON avec la structure suivante :
{
  "date": "${date}",
  "competitions": ["liste des compétitions prioritaires pour aujourd'hui (3-5)"],
  "focus_areas": ["types de paris à prioriser selon le jour (ex: over 2.5 weekend, under 1.5 midweek)"],
  "context": "contexte général du jour en 1-2 phrases (ex: journée chargée Ligue des Champions, derbies attendus...)",
  "reasoning": "pourquoi ce plan (1 phrase, ta réflexion)"
}`

  const { text, model_used } = await callAgentModel('planner', system, userMessage, 512, blackboard, budget)

  const fallback: PlannerOutput = {
    date,
    competitions: ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'],
    focus_areas: ['over 2.5', 'btts oui', 'victoire domicile'],
    context: 'Analyse standard du jour.',
    model_used,
  }
  const parsed = parseAgentJSON<PlannerOutput>(text, fallback)
  const output = { ...parsed, model_used }

  blackboard.post({
    from: 'planner',
    to: 'analyst',
    type: 'plan',
    content: `Focus: ${output.focus_areas.join(', ')} sur ${output.competitions.join(', ')} — ${output.context}`,
  })

  return output
}
