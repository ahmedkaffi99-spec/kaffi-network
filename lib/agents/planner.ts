import { parseAgentJSON, callAgentModel, renderMission } from '@/lib/agent-kernel'
import type { Blackboard } from '@/lib/agent-kernel/blackboard'
import type { RunBudget, AgentMission } from '@/lib/agent-kernel/types'
import type { PlannerOutput } from '@/lib/types'
import { searchTrendingMatches } from '@/lib/tools/serper'

const COMPETITIONS = [
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'Champions League', 'Europa League', 'Championship', 'Liga Portugal', 'Eredivisie',
  'Campeonato Brasileiro', 'Copa Libertadores', 'FIFA World Cup',
]

const MISSION: AgentMission = {
  role: 'planner',
  label: 'le Planificateur',
  responsibility:
    "fixer le plan du jour : quelles compétitions et quels types de paris prioriser, avant toute analyse de données. S'appuie sur une recherche web pour ancrer ce plan sur les matchs réellement au programme, pas uniquement sur sa connaissance générale.",
  doesNot: [
    'Ne sélectionne aucun pick — délégué à l\'Analyste.',
    'Ne consulte aucune donnée de cote — décide sur la base du calendrier, du jour de la semaine et des matchs identifiés sur le web.',
    'Ne valide ni ne publie rien.',
  ],
}

export async function runPlanner(date: string, blackboard: Blackboard, budget: RunBudget): Promise<PlannerOutput> {
  const dayName = new Date(date).toLocaleDateString('fr-FR', { weekday: 'long' })
  const dateLabel = new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  // Heure RÉELLE d'exécution du run — distincte de `date` (la journée
  // ciblée par l'analyse, qui peut être future). Sans ça, le modèle ne sait
  // pas si on tourne à 4h du matin (quasi aucun match encore commencé) ou
  // en soirée (créneau européen classique) — ça change ce qu'il doit
  // raisonnablement attendre comme volume de matchs disponibles.
  const now = new Date()
  const nowLabel = now.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' })

  // Découverte web AVANT toute planification — on ancre le plan sur les
  // matchs dont on parle réellement aujourd'hui plutôt que sur la seule
  // connaissance générale du modèle (qui peut être datée ou générique).
  const trendingResults = await searchTrendingMatches(dateLabel)
  const trendingContext = trendingResults.length
    ? trendingResults.map(r => `[${r.source ?? 'Source'}] ${r.title}: ${r.snippet}`).join('\n')
    : 'Aucun résultat de recherche web exploitable — retombe sur le calendrier connu des compétitions listées.'

  blackboard.post({
    from: 'planner',
    type: 'observation',
    content: `${trendingResults.length} résultats de recherche web sur les matchs du jour.`,
  })

  const system = `${renderMission(MISSION)}

Tu analyses le calendrier football du jour et produis un plan JSON structuré.
Réponds UNIQUEMENT avec du JSON valide, sans markdown ni commentaire.`

  const userMessage = `Date ciblée par cette analyse : ${date} (${dayName})
Heure réelle d'exécution de ce run : ${nowLabel} (UTC) — sers-t'en pour juger si la journée ciblée est déjà bien avancée (peu de matchs encore à venir) ou encore à venir, pas pour changer la date ciblée elle-même.
Compétitions disponibles : ${COMPETITIONS.join(', ')}

Résultats de recherche web sur les matchs/pronostics du jour (${trendingResults.length} résultats) :
${trendingContext}

Génère un plan JSON avec la structure suivante :
{
  "date": "${date}",
  "competitions": ["liste des compétitions prioritaires pour aujourd'hui (3-5)"],
  "focus_areas": ["types de paris à prioriser selon le jour (ex: over 2.5 weekend, under 1.5 midweek)"],
  "trending_matches": ["10 à 15 affiches identifiées dans les résultats de recherche ci-dessus, au format 'Équipe A vs Équipe B' — liste vide si aucun résultat exploitable, n'invente rien"],
  "context": "contexte général du jour en 1-2 phrases (ex: journée chargée Ligue des Champions, derbies attendus...)",
  "reasoning": "pourquoi ce plan (1 phrase, ta réflexion)"
}`

  const { text, model_used } = await callAgentModel('planner', system, userMessage, 768, blackboard, budget)

  // Signalé explicitement comme un repli — sans ça, un échec de parsing du
  // modèle produisait un plan générique indiscernable d'un vrai raisonnement
  // daté (ex: "Analyse standard du jour" identique quelle que soit la date).
  const fallback: PlannerOutput = {
    date,
    competitions: ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'],
    focus_areas: ['over 2.5', 'btts oui', 'victoire domicile'],
    trending_matches: [],
    context: `Plan de secours pour le ${dateLabel} — réponse du modèle illisible, repli sur les grands championnats par défaut.`,
    model_used,
  }
  const parsed = parseAgentJSON<PlannerOutput>(text, fallback)
  const output = { ...parsed, model_used }

  blackboard.post({
    from: 'planner',
    to: 'analyst',
    type: 'plan',
    content: `Focus: ${output.focus_areas.join(', ')} sur ${output.competitions.join(', ')} — ${output.trending_matches.length} affiches tendance identifiées — ${output.context}`,
  })

  return output
}
