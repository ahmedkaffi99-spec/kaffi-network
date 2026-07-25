"""Port de lib/tools/odds-api.ts — The Odds API (api.the-odds-api.com/v4)."""
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

BASE_URL = "https://api.the-odds-api.com/v4"
SPORT = "soccer"

# Bookmaker prioritaire pour la cote finale — cohérence avec le lien affilié.
PRIORITY_BOOKMAKER_KEY = "1xbet"

# Même liste que côté site — utilisée pour filtrer en mode "cotes uniquement"
# (pas de données API-Football pour recadrer la sélection).
KNOWN_LEAGUE_SPORT_KEYS = [
    "epl", "efl_champ", "la_liga", "serie_a", "bundesliga", "ligue_one",
    "primeira_liga", "eredivisie", "brazil_campeonato", "champs_league",
    "europa_league", "conference_league", "fifa_world_cup", "uefa_euro",
    "mls", "liga_mx",
]


def is_known_league(sport_key: str) -> bool:
    key = sport_key.lower()
    return any(k in key for k in KNOWN_LEAGUE_SPORT_KEYS)


@dataclass
class TotalsLine:
    point: float
    over: float | None
    under: float | None


@dataclass
class MatchOdds:
    sport_key: str
    sport_title: str
    home_team: str
    away_team: str
    commence_time: str
    h2h: dict  # {home, draw, away}
    totals: list[TotalsLine] = field(default_factory=list)
    btts: dict = field(default_factory=lambda: {"yes": None, "no": None})
    spreads: dict = field(default_factory=lambda: {"home_point": None, "home_price": None, "away_point": None, "away_price": None})


def _day_window_utc(date: str) -> tuple[str, str]:
    """Fenêtre 00h-00h (UTC) pour une date donnée. Format EXACT attendu par
    l'API, sans les millisecondes (rejeté avec un 422 sinon — vérifié en
    conditions réelles)."""
    frm = f"{date}T00:00:00Z"
    to_dt = datetime.fromisoformat(frm.replace("Z", "+00:00")) + timedelta(days=1)
    to = to_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return frm, to


async def get_today_odds(region: str = "eu", date: str | None = None) -> list[MatchOdds]:
    params = {
        "apiKey": os.environ["ODDS_API_KEY"],
        "regions": region,
        "markets": "h2h,totals,spreads",
        "oddsFormat": "decimal",
        "dateFormat": "iso",
    }
    if date:
        frm, to = _day_window_utc(date)
        params["commenceTimeFrom"] = frm
        params["commenceTimeTo"] = to

    async with httpx.AsyncClient() as client:
        res = await client.get(f"{BASE_URL}/sports/{SPORT}/odds", params=params, timeout=20.0)
        if not res.is_success:
            print(f"[warn] Odds API {res.status_code} — continuing without real-time odds")
            return []
        events = res.json()

    result = []
    for event in events:
        all_markets = [m for bm in event["bookmakers"] for m in bm["markets"]]
        h2h_outcomes = [o for m in all_markets if m["key"] == "h2h" for o in m["outcomes"]]
        totals_outcomes = [o for m in all_markets if m["key"] == "totals" for o in m["outcomes"]]
        btts_outcomes = [o for m in all_markets if m["key"] == "btts" for o in m["outcomes"]]
        spreads_outcomes = [o for m in all_markets if m["key"] == "spreads" for o in m["outcomes"]]

        def avg_odds(outcomes: list[dict], name: str) -> float | None:
            matching = [o for o in outcomes if name.lower() in o["name"].lower()]
            if not matching:
                return None
            return round((sum(o["price"] for o in matching) / len(matching)) * 100) / 100

        totals_points = sorted({o["point"] for o in totals_outcomes if o.get("point") is not None})
        totals = [
            TotalsLine(
                point=point,
                over=avg_odds([o for o in totals_outcomes if o.get("point") == point and "over" in o["name"].lower()], "over"),
                under=avg_odds([o for o in totals_outcomes if o.get("point") == point and "under" in o["name"].lower()], "under"),
            )
            for point in totals_points
        ]

        home_spread = next((o for o in spreads_outcomes if o["name"] == event["home_team"] and o.get("point") is not None), None)
        away_spread = next((o for o in spreads_outcomes if o["name"] == event["away_team"] and o.get("point") is not None), None)

        result.append(
            MatchOdds(
                sport_key=event["sport_key"],
                sport_title=event["sport_title"],
                home_team=event["home_team"],
                away_team=event["away_team"],
                commence_time=event["commence_time"],
                h2h={
                    "home": avg_odds(h2h_outcomes, event["home_team"]),
                    "draw": avg_odds(h2h_outcomes, "draw"),
                    "away": avg_odds(h2h_outcomes, event["away_team"]),
                },
                totals=totals,
                btts={"yes": avg_odds(btts_outcomes, "yes"), "no": avg_odds(btts_outcomes, "no")},
                spreads={
                    "home_point": home_spread["point"] if home_spread else None,
                    "home_price": home_spread["price"] if home_spread else None,
                    "away_point": away_spread["point"] if away_spread else None,
                    "away_price": away_spread["price"] if away_spread else None,
                },
            )
        )

    return result


# Cache en mémoire du process — évite de refaire un fetch par pick candidat
# quand l'Odds Selector interroge plusieurs matchs du même run.
_raw_events_cache: dict | None = None
_RAW_CACHE_TTL_SECONDS = 5 * 60


async def _fetch_raw_odds_events(region: str = "eu") -> list[dict]:
    global _raw_events_cache
    if _raw_events_cache and time.time() - _raw_events_cache["fetched_at"] < _RAW_CACHE_TTL_SECONDS:
        return _raw_events_cache["data"]

    params = {
        "apiKey": os.environ["ODDS_API_KEY"],
        "regions": region,
        "markets": "h2h,totals,spreads",
        "oddsFormat": "decimal",
        "dateFormat": "iso",
    }
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{BASE_URL}/sports/{SPORT}/odds", params=params, timeout=20.0)
        if not res.is_success:
            print(f"[warn] Odds API {res.status_code} — cotes brutes indisponibles")
            return []
        data = res.json()

    _raw_events_cache = {"data": data, "fetched_at": time.time()}
    return data


_STOPWORDS = {"fc", "cf", "sc", "rc", "ac", "ss", "afc", "bsc", "vfb", "rcd", "ssc", "ud", "cd"}


def team_similarity(a: str, b: str) -> float:
    """Similarité par mots communs (robuste aux abréviations et variantes de noms)."""

    def normalize(s: str) -> list[str]:
        s = re.sub(r"[^a-z0-9 ]", "", s.lower())
        return [w for w in s.split() if w and w not in _STOPWORDS]

    wa, wb = normalize(a), set(normalize(b))
    if not wa and not wb:
        return 0.0
    intersection = len([w for w in wa if w in wb])
    union = len(set(wa) | wb)
    return intersection / union if union else 0.0


def find_match_odds(odds: list[MatchOdds], home_team: str, away_team: str) -> MatchOdds | None:
    threshold = 0.3
    best, best_score = None, -1.0

    for o in odds:
        home_score = team_similarity(o.home_team, home_team)
        away_score = team_similarity(o.away_team, away_team)
        score = home_score + away_score

        if home_score >= threshold and away_score >= threshold and score > best_score:
            best_score, best = score, o

    return best


@dataclass
class BookmakerQuote:
    bookmaker: str
    price: float


def _match_outcome(bet_type: str, home_team: str, away_team: str) -> dict | None:
    """Reconnaît le marché/l'issue ciblés par un bet_type texte libre — même
    heuristique que lib/tools/result-checker.ts::evaluate_result (FR + EN)."""
    bt = bet_type.lower()

    over_match = re.search(r"(?:plus de|over)\s*(\d+(?:\.\d+)?)", bet_type, re.IGNORECASE)
    if over_match:
        point = float(over_match.group(1))
        return {
            "market_key": "totals",
            "matches": lambda o: "over" in o["name"].lower() and o.get("point") is not None and abs(o["point"] - point) < 0.01,
        }

    under_match = re.search(r"(?:moins de|under)\s*(\d+(?:\.\d+)?)", bet_type, re.IGNORECASE)
    if under_match:
        point = float(under_match.group(1))
        return {
            "market_key": "totals",
            "matches": lambda o: "under" in o["name"].lower() and o.get("point") is not None and abs(o["point"] - point) < 0.01,
        }

    if "handicap" in bt:
        point_match = re.search(r"[+-]?\d+(?:\.\d+)?", bet_type)
        if not point_match:
            return None
        point = float(point_match.group(0))
        target_team = home_team if team_similarity(bet_type, home_team) >= team_similarity(bet_type, away_team) else away_team
        return {
            "market_key": "spreads",
            "matches": lambda o, _t=target_team: team_similarity(o["name"], _t) >= 0.3 and o.get("point") is not None and abs(o["point"] - point) < 0.01,
        }

    if "victoire" in bt and ("domicile" in bt or "home" in bt):
        return {"market_key": "h2h", "matches": lambda o: team_similarity(o["name"], home_team) >= 0.3}

    if "victoire" in bt and ("extérieur" in bt or "exterieur" in bt or "away" in bt):
        return {"market_key": "h2h", "matches": lambda o: team_similarity(o["name"], away_team) >= 0.3}

    if "nul" in bt or "draw" in bt:
        return {"market_key": "h2h", "matches": lambda o: "draw" in o["name"].lower()}

    return None


async def get_bookmaker_quotes(home_team: str, away_team: str, bet_type: str) -> list[BookmakerQuote]:
    """Détail des cotes par bookmaker pour un pick candidat donné — utilisé
    par l'Odds Selector pour choisir la cote 1xBet en priorité, sinon la
    médiane, et détecter un marché trop incertain (écart entre bookmakers)."""
    outcome = _match_outcome(bet_type, home_team, away_team)
    if not outcome:
        return []

    events = await _fetch_raw_odds_events()
    threshold = 0.3
    event = next(
        (e for e in events if team_similarity(e["home_team"], home_team) >= threshold and team_similarity(e["away_team"], away_team) >= threshold),
        None,
    )
    if not event:
        return []

    quotes = []
    for bookmaker in event["bookmakers"]:
        market = next((m for m in bookmaker["markets"] if m["key"] == outcome["market_key"]), None)
        if not market:
            continue
        outcome_entry = next((o for o in market["outcomes"] if outcome["matches"](o)), None)
        if outcome_entry:
            quotes.append(BookmakerQuote(bookmaker=bookmaker["key"], price=outcome_entry["price"]))

    return quotes
