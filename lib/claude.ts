import Anthropic from '@anthropic-ai/sdk'
import type { MatchAnalysisData } from './football-api'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Seuil de fiabilité : 80% minimum sur 8+ matchs
const RELIABILITY_THRESHOLD = 80
const MIN_SAMPLE_SIZE = 8

const SYSTEM_PROMPT = `Tu es l'analyste sportif de Kaffi Network, spécialisé dans l'identification de tendances statistiques fiables pour les paris sur le football.

## MISSION
Analyser les matchs de football du jour et identifier UNIQUEMENT les picks où une tendance statistique claire est présente.

## RÈGLES DE SÉLECTION (NON NÉGOCIABLES)
1. **Seuil minimum** : ${RELIABILITY_THRESHOLD}% — le pattern doit apparaître dans ≥${RELIABILITY_THRESHOLD}% des derniers matchs
2. **Taille d'échantillon** : minimum ${MIN_SAMPLE_SIZE} matchs analysés (rejette si moins de ${MIN_SAMPLE_SIZE} matchs disponibles)
3. **Nombre de picks** : NON FIXÉ — suit la qualité des données. 0 pick valide = renvoie un tableau vide
4. **Fourchette de cotes suggérées** : 1.35 à 2.80
5. **Football uniquement** — ignore tout autre sport

## TYPES DE TENDANCES À ANALYSER
Pour chaque équipe dans chaque match, vérifie systématiquement :
- Moins de X.5 buts total (1.5 / 2.5 / 3.5)
- Plus de X.5 buts total (1.5 / 2.5 / 3.5)
- BTTS Oui (les deux équipes ont marqué)
- BTTS Non (au moins une équipe n'a pas marqué)
- Clean sheet (équipe n'a pas encaissé)
- Victoire à domicile / à l'extérieur
- Double chance (1X, X2, 12)

## CALCUL DE LA COTE SUGGÉRÉE
Base tes suggestions sur les probabilités implicites classiques :
- 95%+ → ~1.35 | 90% → ~1.45 | 85% → ~1.55 | 82% → ~1.65 | 80% → ~1.75

## FORMAT DE SORTIE
JSON valide UNIQUEMENT. Aucun markdown, aucun texte en dehors du JSON.

{
  "analysis_summary": "Résumé bref (1-2 phrases) de ce que tu as trouvé aujourd'hui",
  "picks": [
    {
      "competition": "Nom du championnat",
      "home_team": "Équipe domicile",
      "away_team": "Équipe extérieur",
      "bet_type": "Description du pari en français",
      "suggested_odds": 1.55,
      "trend_label": "Arsenal: 13/15 derniers matchs sous 3.5 buts",
      "trend_pct": 86.7,
      "sample_size": 15,
      "match_datetime": "2025-07-19T15:00:00Z"
    }
  ]
}

Si aucun pick ne passe le seuil de ${RELIABILITY_THRESHOLD}% sur ${MIN_SAMPLE_SIZE}+ matchs, retourne:
{ "analysis_summary": "Aucune tendance suffisamment solide identifiée aujourd'hui.", "picks": [] }`

export interface ClaudePick {
  competition: string
  home_team: string
  away_team: string
  bet_type: string
  suggested_odds: number
  trend_label: string
  trend_pct: number
  sample_size: number
  match_datetime: string
}

export interface ClaudeAnalysisResult {
  analysis_summary: string
  picks: ClaudePick[]
}

export async function analyzeMatches(
  matchData: MatchAnalysisData[]
): Promise<ClaudeAnalysisResult> {
  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },  // Cache le prompt système (TTL 5min)
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Analyse ces ${matchData.length} matchs de football et identifie les tendances ≥${RELIABILITY_THRESHOLD}% sur ≥${MIN_SAMPLE_SIZE} matchs :\n\n${JSON.stringify(matchData, null, 2)}`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  // Extrait le JSON même si Claude ajoute du texte autour
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`Claude n'a pas retourné de JSON valide. Réponse : ${text.slice(0, 200)}`)
  }

  const result = JSON.parse(jsonMatch[0]) as ClaudeAnalysisResult

  // Validation défensive — filtre les picks qui ne respectent pas le seuil
  result.picks = result.picks.filter(
    p => p.trend_pct >= RELIABILITY_THRESHOLD && p.sample_size >= MIN_SAMPLE_SIZE
  )

  return result
}
