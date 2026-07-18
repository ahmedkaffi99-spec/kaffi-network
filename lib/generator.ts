/**
 * Orchestrateur du pipeline de génération de pronostics.
 *
 * Flux :
 * 1. Récupère tous les matchs foot du jour (football-data.org)
 * 2. Récupère l'historique de chaque équipe impliquée
 * 3. Claude analyse les tendances et sélectionne les picks ≥80% sur ≥8 matchs
 * 4. Calcule la cote combinée
 * 5. Persiste la session + les picks dans Supabase
 */

import { getTodayMatches, buildMatchAnalysisData } from './football-api'
import { analyzeMatches } from './claude'
import { createClient } from './supabase/server'
import type { PronosticSession } from './types'

export async function generateDailyPronostics(): Promise<PronosticSession> {
  const today = new Date().toISOString().split('T')[0]
  const supabase = await createClient()

  // Guard : une seule session par jour
  const { data: existing } = await supabase
    .from('pronostic_sessions')
    .select('id')
    .eq('date', today)
    .single()

  if (existing) {
    throw new Error(`Une session existe déjà pour aujourd'hui (${today}). Supprime-la d'abord si tu veux regénérer.`)
  }

  // 1. Matchs du jour
  const todayMatches = await getTodayMatches()
  if (todayMatches.length === 0) {
    throw new Error('Aucun match de football trouvé pour aujourd\'hui dans les championnats surveillés.')
  }

  // 2. Historique des équipes (avec cache intégré)
  const matchData = await buildMatchAnalysisData(todayMatches)

  // 3. Analyse Claude
  const analysis = await analyzeMatches(matchData)

  // 4. Cote combinée (produit des cotes individuelles)
  const combinedOdds =
    analysis.picks.length > 0
      ? Math.round(analysis.picks.reduce((acc, p) => acc * p.suggested_odds, 1) * 100) / 100
      : null

  // 5. Création de la session
  const { data: session, error: sessionErr } = await supabase
    .from('pronostic_sessions')
    .insert({
      date: today,
      status: 'draft',
      combined_odds: combinedOdds,
      notes: analysis.analysis_summary,
    })
    .select()
    .single()

  if (sessionErr || !session) {
    throw new Error(`Erreur création session : ${sessionErr?.message}`)
  }

  // 6. Insertion des picks
  if (analysis.picks.length > 0) {
    const { error: picksErr } = await supabase.from('picks').insert(
      analysis.picks.map(p => ({
        session_id: session.id,
        competition: p.competition,
        home_team: p.home_team,
        away_team: p.away_team,
        bet_type: p.bet_type,
        odds: p.suggested_odds,
        trend_label: p.trend_label,
        trend_pct: p.trend_pct,
        sample_size: p.sample_size,
        match_datetime: p.match_datetime,
      }))
    )
    if (picksErr) throw new Error(`Erreur insertion picks : ${picksErr.message}`)
  }

  // 7. Retourne la session complète avec picks
  const { data: fullSession } = await supabase
    .from('pronostic_sessions')
    .select('*, picks(*)')
    .eq('id', session.id)
    .single()

  return fullSession as PronosticSession
}
