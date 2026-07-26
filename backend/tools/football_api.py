"""Port de lib/tools/football-api.ts — API-Football (v3.football.api-sports.io)."""
import asyncio
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from .odds_api import team_similarity
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


@dataclass
class H2HMatch:
    date: str
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int


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
    """ATTENTION : `/fixtures?date=X` est restreint par le plan gratuit
    API-Football à une fenêtre étroite autour d'aujourd'hui (constaté en
    pratique : "Free plans do not have access to this date, try from
    J-1 to J+1") — inutilisable pour découvrir une affiche à une date
    lointaine (ex: dans un mois). Pour ce cas, voir `search_team` +
    `get_team_history` ci-dessous (résolution par NOM, pas par date), et
    agents/quant_analyst.py::analyze_named_fixtures qui les utilise."""
    target_date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    data = await _track_request(f"/fixtures?date={target_date}", 1)

    return [
        _map_fixture_to_today_match(entry)
        for entry in data.get("response", [])
        if entry["fixture"]["status"]["short"] in ACTIVE_STATUSES
    ]


async def search_team(name: str) -> TeamRef | None:
    """Résout un nom d'équipe en TeamRef via `/teams?search=NAME` —
    contrairement à `/fixtures?date=`, cet endpoint n'est PAS restreint à une
    fenêtre de dates proche d'aujourd'hui (juste une recherche par nom),
    donc utilisable pour préparer l'analyse d'une affiche à n'importe quelle
    date, même lointaine.

    Respecte le même espacement que get_team_history (RATE_LIMIT_SLEEP) —
    sans ça, un appel search_team juste après un get_team_history (rythme
    réel d'agents/quant_analyst.py::_resolve_team_history) tombe pile dans
    la même fenêtre d'une minute et dépasse la limite de 10 req/min du plan
    gratuit, provoquant des échecs en cascade sur les équipes suivantes."""
    await asyncio.sleep(RATE_LIMIT_SLEEP)
    data = await _track_request(f"/teams?search={name}", 1)
    entries = data.get("response", [])
    if not entries:
        return None

    best, best_score = None, -1.0
    for entry in entries:
        team = entry.get("team", {})
        score = team_similarity(team.get("name", ""), name)
        if score > best_score:
            best_score, best = score, team

    if best_score < 0.3 or best is None:
        return None

    return TeamRef(id=best["id"], name=best["name"], logo=best.get("logo", ""))


async def get_team_history(team_id: int, limit: int = 15) -> list[TeamMatchResult]:
    """Historique récent d'une équipe par ID — restreint par SAISON (le plan
    gratuit ne donne accès qu'aux saisons 2022-2024, cf. `season=2024`
    ci-dessous), pas par la date réelle d'aujourd'hui (contrairement à
    `/fixtures?date=`) — utilisable pour analyser une affiche à venir dans
    plusieurs semaines/mois."""
    await asyncio.sleep(RATE_LIMIT_SLEEP)
    data = await _track_request(f"/fixtures?team={team_id}&season=2024", 1)

    finished = [e for e in data.get("response", []) if e["fixture"]["status"]["short"] in FINISHED_STATUSES]
    finished.sort(key=lambda e: e["fixture"]["date"], reverse=True)
    return [_map_fixture_to_team_match_result(e, team_id) for e in finished[:limit]]


# Constaté en pratique (voir get_head_to_head ci-dessous) : le plan gratuit
# refuse `/fixtures/headtohead` dès que `last` dépasse 2, avec l'erreur
# "Free plans do not have access to the Last parameter." — restriction
# distincte de celle sur `/fixtures?date=` (get_today_matches) et de celle
# par saison (get_team_history).
FREE_PLAN_MAX_H2H_LAST = 2


async def get_head_to_head(team1_id: int, team2_id: int, limit: int = 5) -> list[H2HMatch]:
    """Dernières confrontations directes entre deux équipes via
    `/fixtures/headtohead` — comme get_team_history, restreint par SAISON
    (pas par la date réelle d'aujourd'hui), donc utilisable pour préparer
    l'analyse d'une affiche à venir dans plusieurs semaines/mois. Nécessite
    les deux IDs déjà résolus (voir search_team) — pas de nouvelle recherche
    par nom ici, pour ne pas gaspiller de requêtes déjà comptées ailleurs.

    Replie automatiquement sur FREE_PLAN_MAX_H2H_LAST si le plan gratuit
    refuse la valeur de `limit` demandée — mieux qu'abandonner tout le
    head-to-head pour une restriction qui ne bloque qu'une partie du
    résultat (2 confrontations restent utiles, même si moins que les 5
    demandées)."""
    await asyncio.sleep(RATE_LIMIT_SLEEP)
    try:
        data = await _track_request(f"/fixtures/headtohead?h2h={team1_id}-{team2_id}&last={limit}", 1)
    except RuntimeError as err:
        if limit <= FREE_PLAN_MAX_H2H_LAST or "last parameter" not in str(err).lower():
            raise
        await asyncio.sleep(RATE_LIMIT_SLEEP)
        data = await _track_request(f"/fixtures/headtohead?h2h={team1_id}-{team2_id}&last={FREE_PLAN_MAX_H2H_LAST}", 1)

    finished = [e for e in data.get("response", []) if e["fixture"]["status"]["short"] in FINISHED_STATUSES]
    finished.sort(key=lambda e: e["fixture"]["date"], reverse=True)

    return [
        H2HMatch(
            date=e["fixture"]["date"],
            home_team=e["teams"]["home"]["name"],
            away_team=e["teams"]["away"]["name"],
            home_goals=e["goals"]["home"],
            away_goals=e["goals"]["away"],
        )
        for e in finished[:limit]
    ]


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
            cache[match.home_team.id] = await get_team_history(match.home_team.id, history_limit)
            remaining -= cost_per_team

        if not away_in_cache:
            cache[match.away_team.id] = await get_team_history(match.away_team.id, history_limit)
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
