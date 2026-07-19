import { routeCompletion } from '@/lib/model-router'
import type { PlannerOutput } from '@/lib/types'

const COMPETITIONS = [
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'Champions League', 'Europa League', 'Championship', 'Liga Portugal', 'Eredivisie',
  'Campeonato Brasileiro', 'Copa Libertadores', 'FIFA World Cup',
]

export async function runPlanner(date: string): Promise<PlannerOutput> {
  const dayName = new Date(date).toLocaleDateString('fr-FR', { weekday: 'long' })

  const system = `Tu es le Planner du pipeline Kaffi Network. Tu analyses le calendrier football du jour et produis un plan JSON structuré.
Réponds UNIQUEMENT avec du JSON valide, sans markdown ni commentaire.`

  const userMessage = `Date : ${date} (${dayName})
Compétitions disponibles : ${COMPETITIONS.join(', ')}

Génère un plan JSON avec la structure suivante :
{
  "date": "${date}",
  "competitions": ["liste des compétitions prioritaires pour aujourd'hui (3-5)"],
  "focus_areas": ["types de paris à prioriser selon le jour (ex: over 2.5 weekend, under 1.5 midweek)"],
  "context": "contexte général du jour en 1-2 phrases (ex: journée chargée Ligue des Champions, derbies attendus...)"
}`

  const { text, model_used } = await routeCompletion('planner', system, userMessage, 512)
  const jsonStr = text.startsWith('{') ? text : text.replace(/^```json?\n?/, '').replace(/\n?```$/, '')

  try {
    const parsed = JSON.parse(jsonStr) as PlannerOutput
    return { ...parsed, model_used }
  } catch {
    return {
      date,
      competitions: ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'],
      focus_areas: ['over 2.5', 'btts oui', 'victoire domicile'],
      context: 'Analyse standard du jour.',
      model_used,
    }
  }
}
