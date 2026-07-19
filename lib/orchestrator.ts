import { adminSupabase } from '@/lib/supabase/admin'
import { runPlanner } from '@/lib/agents/planner'
import { runAnalyst } from '@/lib/agents/analyst'
import { runWriter } from '@/lib/agents/writer'
import { runSupervisor } from '@/lib/agents/supervisor'
import { checkDuplicates, savePublishedMatches } from '@/lib/tools/duplicate-checker'
import { generateTicketImage } from '@/lib/tools/image-generator'
import { formatCombinePost, sendPhoto } from '@/lib/tools/telegram'

const MAX_ITERATIONS = 2

export interface OrchestratorResult {
  success: boolean
  sessionId?: string
  message: string
  picksCount?: number
  combinedOdds?: number
  telegramMsgId?: string
}

export async function runPipeline(date?: string): Promise<OrchestratorResult> {
  const targetDate = date ?? new Date().toISOString().split('T')[0]

  // Vérifie si une session publiée existe déjà pour ce jour
  const { data: existing } = await adminSupabase
    .from('pronostic_sessions')
    .select('id, status')
    .eq('date', targetDate)
    .eq('status', 'published')
    .maybeSingle()

  if (existing) {
    return { success: false, sessionId: existing.id, message: 'Session déjà publiée pour ce jour.' }
  }

  // Upsert sur la date : réinitialise la session si elle existe déjà (draft/rejected)
  const { data: session, error: sessionError } = await adminSupabase
    .from('pronostic_sessions')
    .upsert(
      { date: targetDate, status: 'draft', iterations: 0 },
      { onConflict: 'date', ignoreDuplicates: false }
    )
    .select()
    .single()

  if (sessionError || !session) {
    return { success: false, message: `Erreur création session : ${sessionError?.message}` }
  }

  const sessionId = session.id as string

  try {
    // ── Étape 1 : Planner ────────────────────────────────────────────────────
    const plannerOutput = await runPlanner(targetDate)
    await adminSupabase
      .from('pronostic_sessions')
      .update({ planner_output: plannerOutput })
      .eq('id', sessionId)

    // ── Étape 2+3 : Analyst + Supervisor avec feedback itératif ──────────────
    let analystOutput = await runAnalyst(plannerOutput)
    let supervisorResult = await runSupervisor(analystOutput, 1)
    let iteration = 1

    while (supervisorResult.final_verdict === 'rejected' && iteration < MAX_ITERATIONS) {
      iteration++
      // Passe le feedback du superviseur à l'analyst pour qu'il corrige
      analystOutput = await runAnalyst(plannerOutput, supervisorResult.feedback_for_analyst)
      supervisorResult = await runSupervisor(analystOutput, iteration)
    }

    const supervisorNotes = {
      checks: supervisorResult.checks,
      final_verdict: supervisorResult.final_verdict,
      iterations: supervisorResult.iterations,
      model_used: supervisorResult.model_used,
    }

    await adminSupabase
      .from('pronostic_sessions')
      .update({ analyst_output: analystOutput, supervisor_notes: supervisorNotes, iterations: iteration })
      .eq('id', sessionId)

    if (supervisorResult.final_verdict === 'rejected') {
      await adminSupabase
        .from('pronostic_sessions')
        .update({ status: 'rejected', notes: supervisorResult.checks.at(-1)?.feedback })
        .eq('id', sessionId)
      return { success: false, sessionId, message: 'Pipeline rejeté après supervision maximale.' }
    }

    const picks = analystOutput.picks_retenus
    if (!picks.length) {
      await adminSupabase
        .from('pronostic_sessions')
        .update({ status: 'rejected', notes: "Aucun pick retenu par l'analyste." })
        .eq('id', sessionId)
      return { success: false, sessionId, message: 'Aucun pick retenu.' }
    }

    // ── Étape 4 : Duplicate checker ──────────────────────────────────────────
    const { ok, duplicates } = await checkDuplicates(picks, sessionId)
    if (!ok) {
      await adminSupabase
        .from('pronostic_sessions')
        .update({ status: 'rejected', notes: `Doublons détectés : ${duplicates.join(', ')}` })
        .eq('id', sessionId)
      return { success: false, sessionId, message: `Picks déjà publiés : ${duplicates.join(', ')}` }
    }

    // ── Étape 5 : Writer ─────────────────────────────────────────────────────
    const writerOutput = await runWriter(analystOutput, targetDate)
    await adminSupabase
      .from('pronostic_sessions')
      .update({ writer_output: writerOutput })
      .eq('id', sessionId)

    // ── Étape 6 : Sauvegarde des picks ───────────────────────────────────────
    const combinedOdds = picks.reduce((acc, p) => acc * p.odds, 1)

    const { error: picksError } = await adminSupabase.from('picks').insert(
      picks.map(p => ({
        session_id: sessionId,
        competition: p.competition,
        home_team: p.home_team,
        away_team: p.away_team,
        match_datetime: p.match_datetime,
        bet_type: p.bet_type,
        odds: p.odds,
        trend_label: p.trend_label,
        trend_pct: p.trend_pct,
        sample_size: p.sample_size,
        was_rejected: false,
      }))
    )

    if (picksError) throw new Error(`Erreur insertion picks : ${picksError.message}`)

    // ── Étape 7 : Scanner anti-arnaque avant publication ─────────────────────
    const FORBIDDEN = ['garanti', 'garantine', 'sûr à 100', '100% sûr', 'certain à 100', 'infaillible', 'sans risque', 'gagné d\'avance', 'coup sûr']
    const writerLower = writerOutput.toLowerCase()
    const forbidden = FORBIDDEN.filter(w => writerLower.includes(w.toLowerCase()))
    if (forbidden.length > 0) {
      console.warn(`[orchestrator] 🚫 Mots interdits détectés dans le post : ${forbidden.join(', ')}`)
      await adminSupabase
        .from('pronostic_sessions')
        .update({ status: 'rejected', notes: `Post bloqué — mots interdits : ${forbidden.join(', ')}` })
        .eq('id', sessionId)
      return { success: false, sessionId, message: `Post bloqué — mots interdits détectés : ${forbidden.join(', ')}` }
    }

    // ── Étape 8 : Image ticket + envoi Telegram ───────────────────────────────
    const imageBuffer = await generateTicketImage(picks, combinedOdds, targetDate)
    const caption = formatCombinePost(picks, combinedOdds)
    const telegramMsgId = await sendPhoto(imageBuffer, caption)

    // ── Étape 8 : Finalisation ───────────────────────────────────────────────
    await adminSupabase
      .from('pronostic_sessions')
      .update({
        status: 'published',
        combined_odds: Math.round(combinedOdds * 100) / 100,
        published_at: new Date().toISOString(),
        telegram_msg_id: telegramMsgId,
      })
      .eq('id', sessionId)

    await savePublishedMatches(picks, sessionId)

    return {
      success: true,
      sessionId,
      message: `Pipeline réussi — ${picks.length} picks publiés.`,
      picksCount: picks.length,
      combinedOdds: Math.round(combinedOdds * 100) / 100,
      telegramMsgId,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await adminSupabase
      .from('pronostic_sessions')
      .update({ status: 'rejected', notes: `Erreur pipeline : ${msg}` })
      .eq('id', sessionId)
    return { success: false, sessionId, message: `Erreur pipeline : ${msg}` }
  }
}
