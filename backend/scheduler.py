"""Ordonnancement local — remplace vercel.json (Vercel Cron), qui n'existe
plus une fois le site hébergé chez l'utilisateur. Mêmes deux horaires que
la configuration Vercel d'origine (voir vercel.json), tournant dans le même
process que l'API FastAPI (démarré depuis app.py au lancement d'uvicorn).
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from orchestrator import run_pipeline
from tools.result_checker import announce_session_results, check_pending_results

_scheduler: AsyncIOScheduler | None = None


async def _run_generate_job() -> None:
    print("[scheduler] Lancement du pipeline quotidien (génération)...")
    result = await run_pipeline()
    print(f"[scheduler] Pipeline terminé — succès={result['success']} — {result['message']}")


async def _run_check_results_job() -> None:
    print("[scheduler] Vérification des résultats en attente...")
    checked = await check_pending_results()
    announced = await announce_session_results()
    print(f"[scheduler] Résultats : {checked} — Annonces : {announced}")


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    scheduler = AsyncIOScheduler(timezone="UTC")
    # 09:00 UTC — génération quotidienne des combinés (ex-/api/cron/generate)
    scheduler.add_job(_run_generate_job, CronTrigger(hour=9, minute=0), id="generate")
    # 21:00 UTC — vérification des résultats + annonces Telegram (ex-/api/cron/check-results)
    scheduler.add_job(_run_check_results_job, CronTrigger(hour=21, minute=0), id="check-results")
    scheduler.start()
    print("[scheduler] Démarré — génération 09:00 UTC, vérification résultats 21:00 UTC.")

    _scheduler = scheduler
    return scheduler
