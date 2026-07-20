import { adminSupabase } from '@/lib/supabase/admin'
import { runPlanner } from '@/lib/agents/planner'
import { runAnalystAndOdds } from '@/lib/agents/analyst'
import { runWriter } from '@/lib/agents/writer'
import { checkTierStructure, type SupervisorTierResult } from '@/lib/agents/supervisor'
import { checkDuplicates } from '@/lib/tools/duplicate-checker'
import { Blackboard, createBudget, loadLongTermDigest, persistRunTranscript } from '@/lib/agent-kernel'
import type { Tier, TierCombo } from '@/lib/types'

// Identifie ce crew dans la mémoire long terme et le journal des agents —
// le kernel (lib/agent-kernel) est générique, ce pipeline foot n'en est
// qu'une instance parmi d'autres futurs "crews" possibles.
const SCOPE = 'pronostics-foot'
const ALL_TIERS: Tier[] = ['prudent', 'equilibre', 'audacieux']
// Un palier qui échoue aux contrôles structurels automatiques ne fait
// retenter que le Rédacteur (borné) — la composition du combo, elle, est
// déterministe et n'a rien à "revoir". La validation qualitative finale
// (ton, cohérence) n'est plus un agent IA — c'est l'utilisateur qui la
// fait depuis le dashboard (statut 'draft' → Approuver/Rejeter).
const MAX_WRITER_ATTEMPTS = 3

export interface TierResult {
  tier: Tier
  success: boolean
  message: string
  sessionId?: string
  combinedOdds?: number
  picksCount?: number
  telegramMsgId?: string
}

export interface OrchestratorResult {
  success: boolean
  message: string
  tiers: TierResult[]
}

// Prépare un palier jusqu'à 'draft' (picks + post rédigés, contrôles
// automatiques passés) — n'envoie plus rien sur Telegram automatiquement et
// ne s'auto-approuve plus. L'utilisateur valide lui-même le palier depuis le
// dashboard (app/api/sessions/[id]/approve|reject) après avoir lu le post,
// puis envoie sa capture d'écran du coupon réellement misé sur 1xBet (voir
// app/api/publish/[sessionId]/route.ts) pour publier.
async function prepareTier(params: {
  date: string
  combo: TierCombo
  blackboard: Blackboard
  budget: ReturnType<typeof createBudget>
}): Promise<TierResult> {
  const { date, combo, blackboard, budget } = params
  const { tier } = combo

  // 'draft' inclus — un palier en 'draft' attend la validation manuelle de
  // l'utilisateur (Approuver/Rejeter) ; relancer le run l'écraserait et
  // dupliquerait ses picks. 'approved' inclus — sans ça, relancer le run
  // pendant qu'un palier attend la capture 1xBet de l'utilisateur écraserait
  // ce palier en plein milieu (nouveaux picks, alors que l'utilisateur est
  // peut-être déjà en train de miser sur les anciens).
  const { data: existing } = await adminSupabase
    .from('pronostic_sessions')
    .select('id, status')
    .eq('date', date)
    .eq('tier', tier)
    .in('status', ['draft', 'published', 'approved'])
    .maybeSingle()

  if (existing) {
    const label =
      existing.status === 'published'
        ? 'déjà publié'
        : existing.status === 'approved'
        ? 'déjà approuvé, en attente de la capture 1xBet'
        : 'déjà en attente de ta validation manuelle'
    return { tier, success: false, sessionId: existing.id, message: `Palier ${tier} ${label} pour ce jour.` }
  }

  const { data: session, error: sessionError } = await adminSupabase
    .from('pronostic_sessions')
    .upsert({ date, tier, status: 'draft', iterations: 0 }, { onConflict: 'date,tier', ignoreDuplicates: false })
    .select()
    .single()

  if (sessionError || !session) {
    return { tier, success: false, message: `Erreur création session (${tier}) : ${sessionError?.message}` }
  }

  const sessionId = session.id as string

  try {
    let writerOutput = ''
    let check: SupervisorTierResult = { verdict: 'revision_needed', issues: [] }
    let attempt = 0

    while (attempt < MAX_WRITER_ATTEMPTS) {
      attempt++
      // check.feedback de la tentative précédente est transmis au Rédacteur —
      // sans ça, un échec structurel relançait une réécriture "à l'aveugle"
      // qui pouvait reproduire les mêmes problèmes (undefined à la 1ère
      // tentative).
      writerOutput = await runWriter(combo, date, blackboard, budget, check.feedback)
      check = checkTierStructure(combo, writerOutput, blackboard)
      if (check.verdict === 'approved') break
    }

    await adminSupabase
      .from('pronostic_sessions')
      .update({
        writer_output: writerOutput,
        supervisor_notes: { checks: [check], final_verdict: check.verdict === 'approved' ? 'approved' : 'rejected', iterations: attempt },
        iterations: attempt,
      })
      .eq('id', sessionId)

    if (check.verdict !== 'approved') {
      const notes = `Palier ${tier} rejeté — contrôles automatiques échoués après ${attempt} tentative(s) de rédaction.`
      await adminSupabase.from('pronostic_sessions').update({ status: 'rejected', notes }).eq('id', sessionId)
      return { tier, success: false, sessionId, message: notes }
    }

    // ── Duplicate checker (par palier — les picks sont partagés entre paliers) ─
    const { ok, duplicates } = await checkDuplicates(combo.picks, tier)
    if (!ok) {
      blackboard.post({ from: 'orchestrator', type: 'decision', content: `Palier ${tier} bloqué — doublons : ${duplicates.join(', ')}` })
      await adminSupabase
        .from('pronostic_sessions')
        .update({ status: 'rejected', notes: `Doublons détectés : ${duplicates.join(', ')}` })
        .eq('id', sessionId)
      return { tier, success: false, sessionId, message: `Palier ${tier} — picks déjà publiés : ${duplicates.join(', ')}` }
    }

    // ── Sauvegarde des picks ─────────────────────────────────────────────────
    const { error: picksError } = await adminSupabase.from('picks').insert(
      combo.picks.map(p => ({
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
    if (picksError) throw new Error(`Erreur insertion picks (${tier}) : ${picksError.message}`)

    // ── Reste en 'draft' — plus d'auto-approbation ni d'envoi Telegram
    //    automatique ici. C'est l'utilisateur qui lit le post et
    //    approuve/rejette depuis le dashboard (app/api/sessions/[id]/approve
    //    ou reject), puis envoie la capture réelle du coupon misé sur 1xBet
    //    pour publier (app/api/publish/[sessionId]/route.ts).
    await adminSupabase
      .from('pronostic_sessions')
      .update({ combined_odds: combo.combined_odds })
      .eq('id', sessionId)

    blackboard.post({ from: 'orchestrator', type: 'action', content: `Palier ${tier} prêt — en attente de ta validation manuelle.` })

    return {
      tier,
      success: true,
      sessionId,
      message: `Palier ${tier} prêt — ${combo.picks.length} picks, cote ${combo.combined_odds}. En attente de ta validation.`,
      picksCount: combo.picks.length,
      combinedOdds: combo.combined_odds,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    blackboard.post({ from: 'orchestrator', type: 'result', content: `Erreur palier ${tier} : ${msg}` })
    await adminSupabase.from('pronostic_sessions').update({ status: 'rejected', notes: `Erreur pipeline : ${msg}` }).eq('id', sessionId)
    return { tier, success: false, sessionId, message: `Erreur palier ${tier} : ${msg}` }
  }
}

export async function runPipeline(date?: string): Promise<OrchestratorResult> {
  const targetDate = date ?? new Date().toISOString().split('T')[0]

  const blackboard = new Blackboard(crypto.randomUUID())
  // maxModelCalls couvre planner(1) + analyst(1) + jusqu'à 3 paliers ×
  // (MAX_WRITER_ATTEMPTS écrivain + superviseur) — large marge volontaire.
  const budget = createBudget({ maxModelCalls: 32, deadlineMs: 260_000 })
  // Un run peut couvrir jusqu'à 3 sessions (une par palier) — le transcript
  // partagé du blackboard est dupliqué vers chacune en fin de run pour que
  // le "Journal des agents" reste consultable depuis n'importe quel palier.
  const touchedSessionIds: string[] = []

  try {
    const longTermDigest = await loadLongTermDigest(SCOPE)
    blackboard.write('longTermMemory', longTermDigest)

    // ── Planner ───────────────────────────────────────────────────────────
    const plannerOutput = await runPlanner(targetDate, blackboard, budget)

    // ── Analyste (perception + raisonnement LLM, produit des CANDIDATS) et
    //    Sélecteur de cotes (cotes fiables + composition des 3 combinés,
    //    déterministe) — fusionnés en un seul appel depuis l'orchestrateur,
    //    voir lib/agents/analyst.ts:runAnalystAndOdds ─────────────────────
    const { analystOutput, oddsSelectorOutput } = await runAnalystAndOdds(plannerOutput, blackboard, budget)

    if (!analystOutput.picks_retenus.length || !oddsSelectorOutput) {
      return { success: false, message: 'Aucun pick candidat retenu par l\'analyste.', tiers: [] }
    }

    const builtTiers = ALL_TIERS.map(t => oddsSelectorOutput.combos[t]).filter((c): c is TierCombo => !!c)

    if (!builtTiers.length) {
      return { success: false, message: 'Aucun palier constructible aujourd\'hui (cotes fiables insuffisantes).', tiers: [] }
    }

    // ── Par palier : Rédacteur ⇄ Superviseur (retry borné), puis approbation
    //    (la publication réelle attend la capture 1xBet de l'utilisateur) ───
    const tierResults: TierResult[] = []
    for (const combo of builtTiers) {
      const result = await prepareTier({ date: targetDate, combo, blackboard, budget })
      tierResults.push(result)

      // Trace la composition/exclusion sur la session pour audit dashboard
      if (result.sessionId) {
        touchedSessionIds.push(result.sessionId)
        await adminSupabase
          .from('pronostic_sessions')
          .update({ planner_output: plannerOutput, analyst_output: analystOutput, odds_selector_output: oddsSelectorOutput })
          .eq('id', result.sessionId)
      }
    }

    const anySuccess = tierResults.some(t => t.success)
    const summary = tierResults.map(t => t.message).join(' | ')

    return { success: anySuccess, message: summary, tiers: tierResults }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    blackboard.post({ from: 'orchestrator', type: 'result', content: `Erreur pipeline : ${msg}` })
    return { success: false, message: `Erreur pipeline : ${msg}`, tiers: [] }
  } finally {
    // Le blackboard (mémoire court terme) est éphémère — seul son transcript
    // est conservé, dupliqué vers chaque session touchée ce run (voir note
    // ci-dessus). Toujours au moins une écriture "sans session" pour ne pas
    // perdre le transcript si aucune session n'a été créée (ex: échec avant
    // le Sélecteur de cotes).
    if (touchedSessionIds.length) {
      await Promise.all(touchedSessionIds.map(sessionId => persistRunTranscript({ scope: SCOPE, sessionId, blackboard })))
    } else {
      await persistRunTranscript({ scope: SCOPE, blackboard })
    }
  }
}
