"""Port de lib/tools/football-api.ts — API-Football (v3.football.api-sports.io)."""
import asyncio
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from .quota_tracker import get_remaining_quota, increment_quota

BASE_URL = "https://v3.football.api-sports.io"

ACTIVE_STATUSES = {"NS", "TBD", "1H", "2H", "HT", "ET", "BT", "P", "INT", "LIVE"}
FINISHED_STATUSES = {"FT", "AET", "PEN"}
# Plan gratuit : rate limit 10 req/min → 1 requête toutes les 6s minimum.
# Vrai plafond externe, ne pas réduire (risque de bannissement de la clé).
RATE_LIMIT_SLEEP = 7
# Rate limit 7s/call × 2 équipes × 8 matchs — plafond de temps volontaire.
MAX_MATCHES_TO_ANALYZE = 8


@dataclass
class TeamRef:
    id: int
    name: str
    logo: str


@dataclass
class TodayMatch:
    id: int
    competition: str
    home_team: TeamRef
    away_team: TeamRef
    datetime: str


@dataclass
class TeamMatchResult:
    date: str
    opponent: str
    home: bool
    goals_for: int
    goals_against: int
    total_goals: int
    result: str  # 'W' | 'D' | 'L'


@dataclass
class MatchAnalysisData:
    match: TodayMatch
    home_team_last_matches: list[TeamMatchResult] = field(default_factory=list)
    away_team_last_matches: list[TeamMatchResult] = field(default_factory=list)


async def _api_request(path: str) -> dict:
    api_key = os.environ.get("API_FOOTBALL_KEY")
    if not api_key:
        raise RuntimeError("Configuration requise : la clé API_FOOTBALL_KEY est introuvable dans l'environnement.")

    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{BASE_URL}{path}",
            headers={"x-apisports-key": api_key, "Content-Type": "application/json"},
            timeout=20.0,
        )
        if not res.is_success:
            raise RuntimeError(f"API-Football HTTP Error {res.status_code}: {res.text}")

        data = res.json()
        errors = data.get("errors")
        if errors and not isinstance(errors, list) and len(errors) > 0:
            raise RuntimeError(f"API-Football API Error: {errors}")
        return data


async def _track_request(path: str, n: int = 1) -> dict:
    data = await _api_request(path)
    increment_quota("api-football", n)
    return data


def _map_fixture_to_today_match(entry: dict) -> TodayMatch:
    return TodayMatch(
        id=entry["fixture"]["id"],
        competition=entry["league"]["name"],
        home_team=TeamRef(**{"id": entry["teams"]["home"]["id"], "name": entry["teams"]["home"]["name"], "logo": entry["teams"]["home"]["logo"]}),
        away_team=TeamRef(**{"id": entry["teams"]["away"]["id"], "name": entry["teams"]["away"]["name"], "logo": entry["teams"]["away"]["logo"]}),
        datetime=entry["fixture"]["date"],
    )


def _map_fixture_to_team_match_result(entry: dict, team_id: int) -> TeamMatchResult:
    is_home = entry["teams"]["home"]["id"] == team_id
    gf = (entry["goals"]["home"] if is_home else entry["goals"]["away"]) or 0
    ga = (entry["goals"]["away"] if is_home else entry["goals"]["home"]) or 0
    result = "W" if gf > ga else ("D" if gf == ga else "L")

    return TeamMatchResult(
        date=entry["fixture"]["date"],
        opponent=entry["teams"]["away"]["name"] if is_home else entry["teams"]["home"]["name"],
        home=is_home,
        goals_for=gf,
        goals_against=ga,
        total_goals=gf + ga,
        result=result,
    )


async def get_today_matches(date: str | None = None) -> list[TodayMatch]:
    target_date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    data = await _track_request(f"/fixtures?date={target_date}", 1)

    return [
        _map_fixture_to_today_match(entry)
        for entry in data.get("response", [])
        if entry["fixture"]["status"]["short"] in ACTIVE_STATUSES
    ]


async def _get_team_history(team_id: int, limit: int = 15) -> list[TeamMatchResult]:
    await asyncio.sleep(RATE_LIMIT_SLEEP)
    data = await _track_request(f"/fixtures?team={team_id}&season=2024", 1)

    finished = [e for e in data.get("response", []) if e["fixture"]["status"]["short"] in FINISHED_STATUSES]
    finished.sort(key=lambda e: e["fixture"]["date"], reverse=True)
    return [_map_fixture_to_team_match_result(e, team_id) for e in finished[:limit]]


async def build_match_analysis_data(matches: list[TodayMatch], history_limit: int = 15) -> list[MatchAnalysisData]:
    cache: dict[int, list[TeamMatchResult]] = {}
    result: list[MatchAnalysisData] = []
    safety_margin = 5
    cost_per_team = 1

    remaining = get_remaining_quota("api-football")
    limited = matches[:MAX_MATCHES_TO_ANALYZE]

    for match in limited:
        home_in_cache = match.home_team.id in cache
        away_in_cache = match.away_team.id in cache
        cost = (0 if home_in_cache else cost_per_team) + (0 if away_in_cache else cost_per_team)

        if remaining - cost < safety_margin:
            print(f"[quota] Quota insuffisant (restant: {remaining}, coût: {cost}) — arrêt après {len(result)} matchs.")
            break

        if not home_in_cache:
            cache[match.home_team.id] = await _get_team_history(match.home_team.id, history_limit)
            remaining -= cost_per_team

        if not away_in_cache:
            cache[match.away_team.id] = await _get_team_history(match.away_team.id, history_limit)
            remaining -= cost_per_team

        result.append(
            MatchAnalysisData(
                match=match,
                home_team_last_matches=cache[match.home_team.id],
                away_team_last_matches=cache[match.away_team.id],
            )
        )

    return result


async def get_match_result(home_team: str, away_team: str, match_date: str) -> dict | None:
    try:
        data = await _track_request(f"/fixtures?date={match_date}", 1)
        entry = next(
            (
                e
                for e in data.get("response", [])
                if e["teams"]["home"]["name"] == home_team
                and e["teams"]["away"]["name"] == away_team
                and e["fixture"]["status"]["short"] in FINISHED_STATUSES
            ),
            None,
        )
        if not entry or entry["goals"]["home"] is None or entry["goals"]["away"] is None:
            return None
        return {"home": entry["goals"]["home"], "away": entry["goals"]["away"]}
    except Exception:
        return None
