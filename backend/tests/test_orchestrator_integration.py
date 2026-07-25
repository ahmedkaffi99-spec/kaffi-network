"""Test d'intégration du pipeline complet (Planificateur → Analyste →
Sélecteur de cotes → Rédacteur → Superviseur → sauvegarde Supabase), avec
toutes les frontières externes réelles (LLM, API-Football, Odds API,
Serper, Supabase) remplacées par de faux appels déterministes — même
principe que les tests déjà utilisés pour valider python/collect_data.py :
on mocke la frontière, on exerce le vrai code métier autour.

Force le mode "cotes uniquement" de l'Analyste (get_today_matches renvoie
[]) pour éviter d'avoir à simuler tout l'historique API-Football — ce mode
exerce déjà tout le flux réel : Planificateur, perception + raisonnement de
l'Analyste, composition des paliers du Sélecteur de cotes, Rédacteur,
contrôles du Superviseur, et persistance Supabase.
"""
import json

import pytest

import agents.analyst as analyst_module
import agents.odds_selector as odds_selector_module
import agents.planner as planner_module
import agent_kernel.call as call_module
import agent_kernel.memory as agent_memory_module
import orchestrator
import tools.duplicate_checker as duplicate_checker_module
import tools.memory as tools_memory_module
from orchestrator import run_pipeline
from tools.odds_api import BookmakerQuote, MatchOdds
from tests.fake_supabase import FakeSupabase

N_MATCHES = 10


def _fake_odds() -> list[MatchOdds]:
    return [
        MatchOdds(
            sport_key="epl",
            sport_title="Premier League",
            home_team=f"Team{i}",
            away_team=f"Team{i}B",
            commence_time="2026-07-25T15:00:00Z",
            h2h={"home": 1.4 + i * 0.15, "draw": 3.5, "away": 4.0},
        )
        for i in range(N_MATCHES)
    ]


async def _fake_check_team_news(_team: str) -> str:
    return "Aucune actualité notable."


async def _fake_search_trending_matches(_date_label: str) -> list[dict]:
    return []


async def _fake_get_bookmaker_quotes(home_team: str, _away_team: str, _bet_type: str) -> list[BookmakerQuote]:
    idx = int(home_team.replace("Team", ""))
    return [BookmakerQuote(bookmaker="1xbet", price=round(1.4 + idx * 0.15, 2))]


def _fake_route_completion_factory():
    async def fake_route_completion(role: str, _system: str, _user_message: str, _max_tokens: int = 1024) -> dict:
        if role == "planner":
            return {
                "text": json.dumps(
                    {
                        "date": "2026-07-25",
                        "competitions": ["Premier League"],
                        "focus_areas": ["victoire domicile"],
                        "trending_matches": [],
                        "context": "Journée de test.",
                        "reasoning": "Test déterministe.",
                    }
                ),
                "model_used": "fake-planner",
            }
        if role == "analyst":
            picks = [
                {
                    "competition": "Premier League",
                    "home_team": f"Team{i}",
                    "away_team": f"Team{i}B",
                    "match_datetime": "2026-07-25T15:00:00Z",
                    "bet_type": "Victoire domicile",
                    "odds": round(1.4 + i * 0.15, 2),
                    "trend_label": f"Cote marché {round(1.4 + i * 0.15, 2)}",
                    "trend_pct": 70,
                    "sample_size": 0,
                }
                for i in range(N_MATCHES)
            ]
            return {
                "text": json.dumps({"plan": "Test.", "picks_retenus": picks, "picks_rejetés": [], "summary": f"{N_MATCHES} picks de test."}),
                "model_used": "fake-analyst",
            }
        if role == "writer":
            return {
                "text": (
                    "Sélection mesurée du jour. 1️⃣ <b>Team0 VS Team0B</b> → 1 (cote 1.40). "
                    "Cote combinée à suivre. Jouez de façon responsable."
                ),
                "model_used": "fake-writer",
            }
        return {"text": "", "model_used": "unavailable"}

    return fake_route_completion


@pytest.fixture(autouse=True)
def _patch_external_boundaries(monkeypatch):
    fake_db = FakeSupabase()
    monkeypatch.setattr(orchestrator, "admin_supabase", fake_db)
    monkeypatch.setattr(duplicate_checker_module, "admin_supabase", fake_db)
    monkeypatch.setattr(agent_memory_module, "admin_supabase", fake_db)
    monkeypatch.setattr(tools_memory_module, "admin_supabase", fake_db)

    monkeypatch.setattr(call_module, "route_completion", _fake_route_completion_factory())

    monkeypatch.setattr(planner_module, "search_trending_matches", _fake_search_trending_matches)

    async def fake_get_today_matches(_date=None):
        return []

    async def fake_get_today_odds(_region="eu", _date=None):
        return _fake_odds()

    monkeypatch.setattr(analyst_module, "get_today_matches", fake_get_today_matches)
    monkeypatch.setattr(analyst_module, "get_today_odds", fake_get_today_odds)
    monkeypatch.setattr(analyst_module, "check_team_news", _fake_check_team_news)

    monkeypatch.setattr(odds_selector_module, "get_bookmaker_quotes", _fake_get_bookmaker_quotes)

    return fake_db


@pytest.mark.asyncio
async def test_run_pipeline_produces_draft_sessions_for_all_tiers():
    result = await run_pipeline(date="2026-07-25", run_id="test-run-1")

    assert result["success"] is True
    assert {t["tier"] for t in result["tiers"]} == {"prudent", "equilibre", "audacieux"}

    for tier_result in result["tiers"]:
        assert tier_result["success"] is True, tier_result["message"]
        assert tier_result["picks_count"] >= 2
        assert tier_result["combined_odds"] > 1.0


@pytest.mark.asyncio
async def test_run_pipeline_persists_sessions_and_picks_in_draft_status(_patch_external_boundaries):
    fake_db = _patch_external_boundaries
    await run_pipeline(date="2026-07-25", run_id="test-run-2")

    sessions = fake_db._store.get("pronostic_sessions", [])
    assert len(sessions) == 3
    assert all(s["status"] == "draft" for s in sessions)
    assert all(s.get("writer_output") for s in sessions)

    picks = fake_db._store.get("picks", [])
    assert len(picks) > 0
    assert all(p["session_id"] in {s["id"] for s in sessions} for p in picks)


@pytest.mark.asyncio
async def test_run_pipeline_second_run_same_day_does_not_duplicate_sessions():
    await run_pipeline(date="2026-07-25", run_id="test-run-3")
    result_second = await run_pipeline(date="2026-07-25", run_id="test-run-4")

    # Les 3 paliers du jour sont déjà en 'draft' — un second run ne doit
    # rien recréer, juste le signaler (voir orchestrator._prepare_tier).
    assert result_second["success"] is False
    assert all("déjà" in t["message"] for t in result_second["tiers"])
