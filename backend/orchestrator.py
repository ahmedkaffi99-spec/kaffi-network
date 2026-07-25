"""Port de lib/orchestrator.ts."""
import asyncio
import uuid
from datetime import datetime, timezone

from agent_kernel import Blackboard, create_budget, load_long_term_digest, persist_live_message, persist_run_transcript
from agents.analyst import run_analyst_and_odds
from agents.odds_selector import ALL_TIERS
from agents.planner import run_planner
from agents.supervisor import check_tier_structure
from agents.writer import run_writer
from supabase_client import admin_supabase
from tools.duplicate_checker import check_duplicates

# Identifie ce crew dans la mémoire long terme et le journal des agents — le
# kernel (agent_kernel/) est générique, ce pipeline foot n'en est qu'une
# instance parmi d'autres futurs "crews" possibles.
SCOPE = "pronostics-foot"
# Un palier qui échoue aux contrôles structurels automatiques ne fait
# retenter que le Rédacteur (borné) — la composition du combo, elle, est
# déterministe et n'a rien à "revoir". La validation qualitative finale
# (ton, cohérence) n'est plus un agent IA — c'est l'utilisateur qui la fait
# depuis le dashboard (statut 'draft' → Approuver/Rejeter).
MAX_WRITER_ATTEMPTS = 3


async def _prepare_tier(date: str, combo: dict, blackboard: Blackboard, budget) -> dict:
    """Prépare un palier jusqu'à 'draft' (picks + post rédigés, contrôles
    automatiques passés) — n'envoie plus rien sur Telegram automatiquement et
    ne s'auto-approuve plus. L'utilisateur valide lui-même le palier depuis
    le dashboard (routers/sessions.py approve|reject) après avoir lu le
    post, puis envoie sa capture d'écran du coupon réellement misé sur 1xBet
    (voir routers/publish.py) pour publier."""
    tier = combo["tier"]

    # 'draft' inclus — un palier en 'draft' attend la validation manuelle de
    # l'utilisateur (Approuver/Rejeter) ; relancer le run l'écraserait et
    # dupliquerait ses picks. 'approved' inclus — sans ça, relancer le run
    # pendant qu'un palier attend la capture 1xBet de l'utilisateur écraserait
    # ce palier en plein milieu (nouveaux picks, alors que l'utilisateur est
    # peut-être déjà en train de miser sur les anciens).
    existing_res = (
        admin_supabase.table("pronostic_sessions")
        .select("id, status")
        .eq("date", date)
        .eq("tier", tier)
        .in_("status", ["draft", "published", "approved"])
        .maybe_single()
        .execute()
    )
    existing = existing_res.data if existing_res else None

    if existing:
        label = (
            "déjà publié"
            if existing["status"] == "published"
            else "déjà approuvé, en attente de la capture 1xBet"
            if existing["status"] == "approved"
            else "déjà en attente de ta validation manuelle"
        )
        return {"tier": tier, "success": False, "session_id": existing["id"], "message": f"Palier {tier} {label} pour ce jour."}

    session_res = (
        admin_supabase.table("pronostic_sessions")
        .upsert(
            {"date": date, "tier": tier, "status": "draft", "iterations": 0, "run_id": blackboard.run_id},
            on_conflict="date,tier",
        )
        .execute()
    )
    session = session_res.data[0] if session_res.data else None

    if not session:
        return {"tier": tier, "success": False, "message": f"Erreur création session ({tier})"}

    session_id = session["id"]

    try:
        writer_output = ""
        check = {"verdict": "revision_needed", "issues": []}
        attempt = 0

        while attempt < MAX_WRITER_ATTEMPTS:
            attempt += 1
            # check['feedback'] de la tentative précédente est transmis au
            # Rédacteur — sans ça, un échec structurel relançait une
            # réécriture "à l'aveugle" qui pouvait reproduire les mêmes
            # problèmes (absent à la 1ère tentative).
            writer_output = await run_writer(combo, date, blackboard, budget, check.get("feedback"))
            check = check_tier_structure(combo, writer_output, blackboard)
            if check["verdict"] == "approved":
                break

        admin_supabase.table("pronostic_sessions").update(
            {
                "writer_output": writer_output,
                "supervisor_notes": {
                    "checks": [check],
                    "final_verdict": "approved" if check["verdict"] == "approved" else "rejected",
                    "iterations": attempt,
                },
                "iterations": attempt,
            }
        ).eq("id", session_id).execute()

        if check["verdict"] != "approved":
            notes = f"Palier {tier} rejeté — contrôles automatiques échoués après {attempt} tentative(s) de rédaction."
            admin_supabase.table("pronostic_sessions").update({"status": "rejected", "notes": notes}).eq("id", session_id).execute()
            return {"tier": tier, "success": False, "session_id": session_id, "message": notes}

        # ── Duplicate checker (par palier — les picks sont partagés entre paliers) ─
        dup = check_duplicates(combo["picks"], tier)
        if not dup["ok"]:
            blackboard.post(from_role="orchestrator", type="decision", content=f"Palier {tier} bloqué — doublons : {', '.join(dup['duplicates'])}")
            admin_supabase.table("pronostic_sessions").update(
                {"status": "rejected", "notes": f"Doublons détectés : {', '.join(dup['duplicates'])}"}
            ).eq("id", session_id).execute()
            return {"tier": tier, "success": False, "session_id": session_id, "message": f"Palier {tier} — picks déjà publiés : {', '.join(dup['duplicates'])}"}

        # ── Sauvegarde des picks ─────────────────────────────────────────────
        admin_supabase.table("picks").insert(
            [
                {
                    "session_id": session_id,
                    "competition": p["competition"],
                    "home_team": p["home_team"],
                    "away_team": p["away_team"],
                    "match_datetime": p["match_datetime"],
                    "bet_type": p["bet_type"],
                    "odds": p["odds"],
                    "trend_label": p["trend_label"],
                    "trend_pct": p["trend_pct"],
                    "sample_size": p["sample_size"],
                    "was_rejected": False,
                }
                for p in combo["picks"]
            ]
        ).execute()

        # ── Reste en 'draft' — plus d'auto-approbation ni d'envoi Telegram
        #    automatique ici. C'est l'utilisateur qui lit le post et
        #    approuve/rejette depuis le dashboard (routers/sessions.py
        #    approve/reject), puis envoie la capture réelle du coupon misé
        #    sur 1xBet pour publier (routers/publish.py).
        admin_supabase.table("pronostic_sessions").update({"combined_odds": combo["combined_odds"]}).eq("id", session_id).execute()

        blackboard.post(from_role="orchestrator", type="action", content=f"Palier {tier} prêt — en attente de ta validation manuelle.")

        return {
            "tier": tier,
            "success": True,
            "session_id": session_id,
            "message": f"Palier {tier} prêt — {len(combo['picks'])} picks, cote {combo['combined_odds']}. En attente de ta validation.",
            "picks_count": len(combo["picks"]),
            "combined_odds": combo["combined_odds"],
        }
    except Exception as err:
        msg = str(err)
        blackboard.post(from_role="orchestrator", type="result", content=f"Erreur palier {tier} : {msg}")
        admin_supabase.table("pronostic_sessions").update({"status": "rejected", "notes": f"Erreur pipeline : {msg}"}).eq("id", session_id).execute()
        return {"tier": tier, "success": False, "session_id": session_id, "message": f"Erreur palier {tier} : {msg}"}


async def run_pipeline(date: str | None = None, run_id: str | None = None) -> dict:
    """`run_id` est optionnel : le dashboard en génère un côté navigateur avant
    d'appeler /api/generate pour pouvoir démarrer le polling de la vue "live"
    (agent_messages filtré par run_id) avant même que ce run ne commence à
    poster des messages. Le cron/scheduler (aucune vue live à alimenter)
    laisse le kernel en générer un."""
    target_date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    effective_run_id = run_id or str(uuid.uuid4())

    def _on_message(msg):
        try:
            persist_live_message(SCOPE, effective_run_id, msg)
        except Exception as err:
            print(f"[orchestrator] échec persistance live du message: {err}")

    blackboard = Blackboard(effective_run_id, on_message=_on_message)
    # max_model_calls couvre planner(1) + analyst(1) + jusqu'à 3 paliers ×
    # (MAX_WRITER_ATTEMPTS écrivain + superviseur) — large marge volontaire.
    budget = create_budget(max_model_calls=32, deadline_seconds=260.0)
    # Un run peut couvrir jusqu'à 3 sessions (une par palier) — le
    # transcript partagé du blackboard est dupliqué vers chacune en fin de
    # run pour que le "Journal des agents" reste consultable depuis
    # n'importe quel palier.
    touched_session_ids: list[str] = []

    try:
        long_term_digest = load_long_term_digest(SCOPE)
        blackboard.write("longTermMemory", long_term_digest)

        # ── Planner + perception de l'Analyste EN PARALLÈLE ─────────────────
        # La perception (API-Football, cotes, actualités) ne dépend que de la
        # date, connue avant même que le Planificateur ne tourne — les faire
        # démarrer ensemble économise le temps du Planificateur (recherche
        # web + appel modèle) au lieu de l'attendre pour rien avant de
        # commencer la partie la plus longue du run. Voir agents/analyst.py:
        # run_analyst_and_odds.
        # asyncio.create_task (pas juste l'appel de la coroutine) — un objet
        # Task peut être attendu plusieurs fois (ici par run_analyst_and_odds
        # PUIS par la ligne planner_output ci-dessous), contrairement à une
        # coroutine nue qui ne peut être awaited qu'une seule fois en Python.
        planner_task = asyncio.create_task(run_planner(target_date, blackboard, budget))
        result = await run_analyst_and_odds(target_date, planner_task, blackboard, budget)
        analyst_output, odds_selector_output = result["analyst_output"], result["odds_selector_output"]
        planner_output = await planner_task

        if not analyst_output["picks_retenus"] or not odds_selector_output:
            return {"success": False, "message": "Aucun pick candidat retenu par l'analyste.", "tiers": [], "run_id": effective_run_id}

        built_tiers = [odds_selector_output["combos"][t] for t in ALL_TIERS if odds_selector_output["combos"].get(t)]

        if not built_tiers:
            return {"success": False, "message": "Aucun palier constructible aujourd'hui (cotes fiables insuffisantes).", "tiers": [], "run_id": effective_run_id}

        # ── Par palier : Rédacteur ⇄ Superviseur (retry borné), puis
        #    approbation (la publication réelle attend la capture 1xBet de
        #    l'utilisateur) ────────────────────────────────────────────────
        tier_results: list[dict] = []
        for combo in built_tiers:
            tier_result = await _prepare_tier(target_date, combo, blackboard, budget)
            tier_results.append(tier_result)

            # Trace la composition/exclusion sur la session pour audit dashboard
            if tier_result.get("session_id"):
                touched_session_ids.append(tier_result["session_id"])
                admin_supabase.table("pronostic_sessions").update(
                    {"planner_output": planner_output, "analyst_output": analyst_output, "odds_selector_output": odds_selector_output}
                ).eq("id", tier_result["session_id"]).execute()

        any_success = any(t["success"] for t in tier_results)
        summary = " | ".join(t["message"] for t in tier_results)

        return {"success": any_success, "message": summary, "tiers": tier_results, "run_id": effective_run_id}
    except Exception as err:
        msg = str(err)
        blackboard.post(from_role="orchestrator", type="result", content=f"Erreur pipeline : {msg}")
        return {"success": False, "message": f"Erreur pipeline : {msg}", "tiers": [], "run_id": effective_run_id}
    finally:
        # Le blackboard (mémoire court terme) est éphémère — seul son
        # transcript est conservé, dupliqué vers chaque session touchée ce
        # run (voir note ci-dessus). Toujours au moins une écriture "sans
        # session" pour ne pas perdre le transcript si aucune session n'a
        # été créée (ex: échec avant le Sélecteur de cotes).
        if touched_session_ids:
            for session_id in touched_session_ids:
                persist_run_transcript(SCOPE, blackboard, session_id=session_id)
        else:
            persist_run_transcript(SCOPE, blackboard)
