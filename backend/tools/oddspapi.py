"""OddsPapi (https://oddspapi.io/en/docs, host api.oddspapi.io) — fournisseur de
cotes alternatif à The Odds API (tools/odds_api.py), couvrant beaucoup plus de
marchés (handicaps asiatique/européen, totaux par équipe, BTTS, double
chance...) et beaucoup plus de compétitions/matchs obscurs.

Port adapté (async/httpx) de la logique déjà validée en production par
l'utilisateur dans son script `collecte_donnees.py` (bet_agent) — mêmes
endpoints, même cache des noms de marché, même correspondance floue des noms
d'équipe. Particularité de ce fournisseur : la clé passe en paramètre de
requête (`apiKey=...`), pas dans un en-tête, contrairement à API-Football/The
Odds API.
"""
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

from tools.odds_api import team_similarity

BASE_URL = "https://api.oddspapi.io/v4"
SPORT_ID_FOOTBALL = 10
PRIORITY_BOOKMAKER = "1xbet"

# Confirmé dans le script de production de l'utilisateur (collecte_donnees.py)
# — le marché 1X2 s'appelle "1x2" (marketType) / "Full Time Result" (marketName).
MARKET_TYPE_1X2 = "1x2"
MARKET_NAME_1X2 = "Full Time Result"

# Les noms de marché ne changent pas en cours de run — cache process-wide,
# 1 seul appel réseau quel que soit le nombre d'affiches analysées ensuite.
_market_names_cache: dict[str, dict] = {}

# Fenêtre de cache courte sur la liste des fixtures (gros payload, ne change
# pas d'une affiche à l'autre dans le même run).
_fixtures_cache: tuple[float, list[dict]] | None = None
FIXTURES_CACHE_TTL_SECONDS = 300


def _api_key() -> str:
    key = os.environ.get("ODDSPAPI_KEY")
    if not key:
        raise RuntimeError("Configuration requise : la clé ODDSPAPI_KEY est introuvable dans l'environnement.")
    return key


@dataclass
class OddsPapiSelection:
    selection: str
    price: float


@dataclass
class OddsPapiMarket:
    market_id: str
    name: str
    market_type: str | None
    handicap: float | None
    period: str | None
    selections: list[OddsPapiSelection] = field(default_factory=list)


async def get_market_names() -> dict[str, dict]:
    global _market_names_cache
    if _market_names_cache:
        return _market_names_cache

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{BASE_URL}/markets", params={"apiKey": _api_key()}, timeout=15.0)
            if not res.is_success:
                return {}
            data = res.json()
    except httpx.HTTPError:
        return {}

    names: dict[str, dict] = {}
    for m in data:
        if m.get("sportId") != SPORT_ID_FOOTBALL:
            continue
        outcomes = {str(o["outcomeId"]): o["outcomeName"] for o in m.get("outcomes", [])}
        names[str(m["marketId"])] = {
            "name": m.get("marketName"),
            "type": m.get("marketType"),
            "handicap": m.get("handicap"),
            "period": m.get("period"),
            "outcomes": outcomes,
        }

    _market_names_cache = names
    return _market_names_cache


async def get_fixtures(days_ahead: int = 45) -> list[dict]:
    """Fenêtre glissante depuis aujourd'hui 00h00 UTC — même format de date
    (sans millisecondes) que tools/odds_api.py::_day_window_utc. 45 jours
    par défaut (plutôt que les 2 jours du pipeline quotidien automatisé de
    l'utilisateur, voir bet_agent/collecte_donnees.py) : ce module sert
    aussi à l'analyse manuelle d'affiches prévues plusieurs semaines à
    l'avance (voir agents/quant_analyst.py::analyze_named_fixture). Les
    bookmakers ne publient pas forcément encore de cotes aussi loin à
    l'avance pour autant — une fenêtre large ne garantit pas que la cote
    existe déjà, juste qu'on ne la ratera pas si elle est publiée tôt."""
    global _fixtures_cache
    now = time.monotonic()
    if _fixtures_cache and now - _fixtures_cache[0] < FIXTURES_CACHE_TTL_SECONDS:
        return _fixtures_cache[1]

    date_from = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    date_to = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).strftime("%Y-%m-%dT00:00:00Z")

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{BASE_URL}/fixtures",
                params={"apiKey": _api_key(), "sportId": SPORT_ID_FOOTBALL, "from": date_from, "to": date_to},
                timeout=20.0,
            )
            if not res.is_success:
                return []
            fixtures = res.json()
    except httpx.HTTPError:
        return []

    fixtures = fixtures if isinstance(fixtures, list) else []
    _fixtures_cache = (now, fixtures)
    return fixtures


def find_fixture(home_team: str, away_team: str, fixtures: list[dict]) -> dict | None:
    threshold = 0.3
    best, best_score = None, -1.0
    for fx in fixtures:
        home_score = team_similarity(fx.get("participant1Name", ""), home_team)
        away_score = team_similarity(fx.get("participant2Name", ""), away_team)
        score = home_score + away_score
        if home_score >= threshold and away_score >= threshold and score > best_score:
            best_score, best = score, fx
    return best


async def get_markets_for_fixture(fixture_id: str, bookmaker: str = PRIORITY_BOOKMAKER) -> list[OddsPapiMarket]:
    """Tous les marchés disponibles pour une affiche (1X2 inclus,
    contrairement au script de collecte de l'utilisateur qui l'exclut
    volontairement — ici on en a besoin, voir agents/quant_analyst.py)."""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{BASE_URL}/odds",
                params={"apiKey": _api_key(), "fixtureId": fixture_id, "bookmakers": bookmaker, "oddsFormat": "decimal"},
                timeout=20.0,
            )
            if not res.is_success:
                return []
            data = res.json()
    except httpx.HTTPError:
        return []

    market_names = await get_market_names()
    events = data if isinstance(data, list) else [data]
    markets: list[OddsPapiMarket] = []

    for event in events:
        bookmaker_odds = event.get("bookmakerOdds", {}).get(bookmaker, {})
        for market_id, market_data in bookmaker_odds.get("markets", {}).items():
            info = market_names.get(str(market_id), {})
            outcomes_names = info.get("outcomes", {})
            selections = []
            for outcome_id, outcome_data in market_data.get("outcomes", {}).items():
                price = (outcome_data.get("players") or {}).get("0", {}).get("price")
                if price:
                    selections.append(OddsPapiSelection(selection=outcomes_names.get(str(outcome_id), f"Option {outcome_id}"), price=price))
            if selections:
                markets.append(
                    OddsPapiMarket(
                        market_id=str(market_id),
                        name=info.get("name") or f"Marché {market_id}",
                        market_type=info.get("type"),
                        handicap=info.get("handicap"),
                        period=info.get("period"),
                        selections=selections,
                    )
                )

    return markets


def find_selection_price(
    markets: list[OddsPapiMarket],
    market_type: str | None = None,
    market_name: str | None = None,
    handicap: float | None = None,
    selection: str | None = None,
) -> float | None:
    """Cherche la cote d'une sélection précise parmi des marchés déjà
    récupérés — au moins un critère de marché (`market_type` ou `market_name`)
    doit être fourni."""
    for m in markets:
        if market_type is not None and m.market_type != market_type:
            continue
        if market_name is not None and m.name != market_name:
            continue
        if handicap is not None and (m.handicap is None or abs(m.handicap - handicap) > 1e-9):
            continue
        for sel in m.selections:
            if selection is None or sel.selection.lower() == selection.lower():
                return sel.price
    return None


async def get_bookmaker_price(
    home_team: str,
    away_team: str,
    market_type: str | None = None,
    market_name: str | None = None,
    handicap: float | None = None,
    selection: str | None = None,
) -> float | None:
    """Point d'entrée pratique — retrouve l'affiche par nom d'équipe puis la
    cote d'un marché précis. Renvoie None si l'affiche ou la sélection est
    introuvable (jamais d'exception non attrapée, cohérent avec le reste du
    projet — voir tools/odds_api.py::get_bookmaker_quotes)."""
    fixtures = await get_fixtures()
    fixture = find_fixture(home_team, away_team, fixtures)
    if not fixture:
        return None

    markets = await get_markets_for_fixture(fixture["fixtureId"])
    return find_selection_price(markets, market_type=market_type, market_name=market_name, handicap=handicap, selection=selection)
