import { adminSupabase } from '@/lib/supabase/admin'
import { runPlanner } from '@/lib/agents/planner'
import { gatherAnalystContext, reasonAnalystPicks } from '@/lib/agents/analyst'
import { runWriter } from '@/lib/agents/writer'
import { runSupervisor } from '@/lib/agents/supervisor'
import { checkDuplicates, savePublishedMatches } from '@/lib/tools/duplicate-checker'
import { generateTicketImage } from '@/lib/tools/image-generator'
import { formatCombinePost, sendPhoto } from '@/lib/tools/telegram'
import { Blackboard, createBudget, budgetExceeded, loadLongTermDigest, persistLongTermLesson, persistRunTranscript } from '@/lib/agent-kernel'

// Identifie ce crew dans la mémoire long terme et le journal des agents —
// le kernel (lib/agent-kernel) est générique, ce pipeline foot n'en est
// qu'une instance parmi d'autres futurs "crews" possibles.
const SCOPE = 'pronostics-foot'

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
  const blackboard = new Blackboard(crypto.randomUUID())
  // Boucle bornée et prévisible : plafond d'itérations ET budget d'appels
  // modèle/temps, pour rester compatible avec le timeout Vercel (300s) même
  // si la boucle de révision analyste ⇄ superviseur va au bout.
  const budget = createBudget({ maxIterations: 3, maxModelCalls: 12, deadlineMs: 260_000 })

  try {
    const longTermDigest = await loadLongTermDigest(SCOPE)
    blackboard.write('longTermMemory', longTermDigest)

    // ── Étape 1 : Planner ────────────────────────────────────────────────────
    const plannerOutput = await runPlanner(targetDate, blackboard, budget)
    await adminSupabase
      .from('pronostic_sessions')
      .update({ planner_output: plannerOutput })
      .eq('id', sessionId)

    // ── Étape 2 : Perception — une seule fois, réutilisée à chaque itération ─
    const analystContext = await gatherAnalystContext(plannerOutput, blackboard)

    // ── Étape 3 : Analyst ⇄ Supervisor avec feedback itératif, budget-aware ──
    let analystOutput = await reasonAnalystPicks(plannerOutput, analystContext, undefined, blackboard, budget)
    blackboard.post({
      from: 'analyst',
      to: 'supervisor',
      type: 'decision',
      content: `${analystOutput.picks_retenus.length} picks retenus — ${analystOutput.summary}`,
    })

    let supervisorResult = await runSupervisor(analystOutput, 1, blackboard, budget)
    let iteration = 1

    while (supervisorResult.final_verdict === 'rejected' && iteration < budget.maxIterations) {
      const exceeded = budgetExceeded(budget, blackboard)
      if (exceeded) {
        blackboard.post({ from: 'supervisor', type: 'decision', content: `Arrêt anticipé de la révision — ${exceeded}.` })
        break
      }
      iteration++
      analystOutput = await reasonAnalystPicks(plannerOutput, analystContext, supervisorResult.feedback_for_analyst, blackboard, budget)
      blackboard.post({
        from: 'analyst',
        to: 'supervisor',
        type: 'decision',
        content: `Itération ${iteration} — ${analystOutput.picks_retenus.length} picks révisés.`,
      })
      supervisorResult = await runSupervisor(analystOutput, iteration, blackboard, budget)
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

    if (supervisorResult.lesson_for_memory) {
      await persistLongTermLesson(SCOPE, `lesson-${sessionId}`, supervisorResult.lesson_for_memory)
    }

    const picks = analystOutput.picks_retenus

    // La décision du superviseur doit réellement bloquer la publication —
    // pas seulement l'absence de picks. Avant, un rejet persistant après la
    // dernière itération n'empêchait pas la publication tant que la liste de
    // picks n'était pas vide.
    if (!picks.length || supervisorResult.final_verdict !== 'approved') {
      const notes = picks.length
        ? 'Combiné rejeté par le superviseur après les itérations de révision disponibles.'
        : "Aucun pick retenu par l'analyste."
      await adminSupabase.from('pronostic_sessions').update({ status: 'rejected', notes }).eq('id', sessionId)
      return { success: false, sessionId, message: notes }
    }

    // ── Étape 4 : Duplicate checker ──────────────────────────────────────────
    const { ok, duplicates } = await checkDuplicates(picks, sessionId)
    if (!ok) {
      blackboard.post({ from: 'orchestrator', type: 'decision', content: `Publication bloquée — doublons : ${duplicates.join(', ')}` })
      await adminSupabase
        .from('pronostic_sessions')
        .update({ status: 'rejected', notes: `Doublons détectés : ${duplicates.join(', ')}` })
        .eq('id', sessionId)
      return { success: false, sessionId, message: `Picks déjà publiés : ${duplicates.join(', ')}` }
    }

    // ── Étape 5 : Writer ─────────────────────────────────────────────────────
    const writerOutput = await runWriter(analystOutput, targetDate, blackboard, budget)
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
      blackboard.post({ from: 'orchestrator', type: 'decision', content: `Publication bloquée — mots interdits : ${forbidden.join(', ')}` })
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
    blackboard.post({ from: 'orchestrator', type: 'action', content: `Publié sur Telegram — message #${telegramMsgId}.` })

    // ── Étape 9 : Finalisation ───────────────────────────────────────────────
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
    blackboard.post({ from: 'orchestrator', type: 'result', content: `Erreur pipeline : ${msg}` })
    await adminSupabase
      .from('pronostic_sessions')
      .update({ status: 'rejected', notes: `Erreur pipeline : ${msg}` })
      .eq('id', sessionId)
    return { success: false, sessionId, message: `Erreur pipeline : ${msg}` }
  } finally {
    // Le blackboard (mémoire court terme) est éphémère — seul son transcript
    // est conservé, quel que soit le chemin de sortie du pipeline.
    await persistRunTranscript({ scope: SCOPE, sessionId, blackboard })
  }
}
