#!/usr/bin/env python3
"""
Collecte les données du jour (matchs, historiques d'équipes, cotes bookmaker,
actualités) et les enregistre dans un fichier JSON.

Ce script ne fait AUCUNE analyse ni sélection de picks — c'est Claude Code
qui lit le fichier produit et raisonne dessus (mêmes règles que l'Analyste du
site : tendance >= 80% sur >= 8 matchs, cote entre 1.35 et 6.0, cote fiable
si l'écart entre bookmakers est <= 20%). Séparer collecte et analyse évite un
appel API LLM payant à chaque génération.

Usage :
    python collect_data.py [YYYY-MM-DD]   (par défaut : aujourd'hui, UTC)

Variables d'environnement requises (voir .env.example) :
    API_FOOTBALL_KEY, ODDS_API_KEY
Optionnelle :
    SERPER_API_KEY (actualités blessures/suspensions — sans elle, le champ
    "news" reste vide, l'analyse fonctionne quand même)
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

API_FOOTBALL_BASE = "https://v3.football.api-sports.io"
ODDS_API_BASE = "https://api.the-odds-api.com/v4"

# Plan gratuit API-Football : 10 requêtes/minute → 7s entre deux appels
# minimum. Vrai plafond externe, ne pas réduire (risque de bannissement de
# la clé). Voir lib/tools/football-api.ts côté site pour la même constante.
RATE_LIMIT_SLEEP = 7
MAX_MATCHES = 8

ACTIVE_STATUSES = {"NS", "TBD", "1H", "2H", "HT", "ET", "BT", "P", "INT", "LIVE"}
FINISHED_STATUSES = {"FT", "AET", "PEN"}

# Même liste que lib/tools/odds-api.ts::KNOWN_LEAGUE_SPORT_KEYS — utilisée
# uniquement si API-Football est indisponible (mode "cotes seules"), pour ne
# pas proposer des championnats obscurs que personne ne reconnaît.
KNOWN_LEAGUE_SPORT_KEYS = [
    "epl", "efl_champ", "la_liga", "serie_a", "bundesliga", "ligue_one",
    "primeira_liga", "eredivisie", "brazil_campeonato", "champs_league",
    "europa_league", "conference_league", "fifa_world_cup", "uefa_euro",
    "mls", "liga_mx",
]


def is_known_league(sport_key: str) -> bool:
    key = sport_key.lower()
    return any(k in key for k in KNOWN_LEAGUE_SPORT_KEYS)


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"Erreur : variable d'environnement {name} manquante (voir .env.example).", file=sys.stderr)
        sys.exit(1)
    return value


# ── API-Football ─────────────────────────────────────────────────────────

def api_football_get(path: str, params: dict | None = None) -> dict:
    headers = {"x-apisports-key": require_env("API_FOOTBALL_KEY")}
    res = requests.get(f"{API_FOOTBALL_BASE}{path}", headers=headers, params=params or {}, timeout=20)
    res.raise_for_status()
    data = res.json()
    errors = data.get("errors")
    if errors and not isinstance(errors, list) and len(errors) > 0:
        raise RuntimeError(f"API-Football error: {errors}")
    return data


def get_today_matches(date: str) -> list[dict]:
    data = api_football_get("/fixtures", {"date": date})
    matches = []
    for entry in data.get("response", []):
        if entry["fixture"]["status"]["short"] not in ACTIVE_STATUSES:
            continue
        matches.append({
            "home_team": {
                "id": entry["teams"]["home"]["id"],
                "name": entry["teams"]["home"]["name"],
                "logo": entry["teams"]["home"]["logo"],
            },
            "away_team": {
                "id": entry["teams"]["away"]["id"],
                "name": entry["teams"]["away"]["name"],
                "logo": entry["teams"]["away"]["logo"],
            },
            "competition": entry["league"]["name"],
            "datetime": entry["fixture"]["date"],
        })
    return matches


def map_result(entry: dict, team_id: int) -> dict:
    is_home = entry["teams"]["home"]["id"] == team_id
    gf = (entry["goals"]["home"] if is_home else entry["goals"]["away"]) or 0
    ga = (entry["goals"]["away"] if is_home else entry["goals"]["home"]) or 0
    result = "W" if gf > ga else ("D" if gf == ga else "L")
    return {
        "date": entry["fixture"]["date"],
        "opponent": entry["teams"]["away"]["name"] if is_home else entry["teams"]["home"]["name"],
        "home": is_home,
        "goals_for": gf,
        "goals_against": ga,
        "total_goals": gf + ga,
        "result": result,
    }


def get_team_history(team_id: int, limit: int = 15) -> list[dict]:
    time.sleep(RATE_LIMIT_SLEEP)
    data = api_football_get("/fixtures", {"team": team_id, "season": 2024})
    finished = [e for e in data.get("response", []) if e["fixture"]["status"]["short"] in FINISHED_STATUSES]
    finished.sort(key=lambda e: e["fixture"]["date"], reverse=True)
    return [map_result(e, team_id) for e in finished[:limit]]


# ── The Odds API ─────────────────────────────────────────────────────────

def get_today_odds(date: str) -> list[dict]:
    params = {
        "apiKey": require_env("ODDS_API_KEY"),
        "regions": "eu",
        "markets": "h2h,totals,spreads",
        "oddsFormat": "decimal",
        "dateFormat": "iso",
    }
    if date:
        frm = f"{date}T00:00:00Z"
        to_dt = datetime.fromisoformat(frm.replace("Z", "+00:00")) + timedelta(days=1)
        params["commenceTimeFrom"] = frm
        params["commenceTimeTo"] = to_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    res = requests.get(f"{ODDS_API_BASE}/sports/soccer/odds", params=params, timeout=20)
    if not res.ok:
        print(f"[warn] Odds API {res.status_code} — pas de cotes disponibles", file=sys.stderr)
        return []
    return res.json()


def team_similarity(a: str, b: str) -> float:
    stopwords = {"fc", "cf", "sc", "rc", "ac", "ss", "afc", "bsc", "vfb", "rcd", "ssc", "ud", "cd"}

    def normalize(s: str) -> list[str]:
        s = re.sub(r"[^a-z0-9 ]", "", s.lower())
        return [w for w in s.split() if w and w not in stopwords]

    wa, wb = normalize(a), set(normalize(b))
    if not wa and not wb:
        return 0.0
    inter = len([w for w in wa if w in wb])
    union = len(set(wa) | wb)
    return inter / union if union else 0.0


def find_match_odds(odds_events: list[dict], home_team: str, away_team: str) -> dict | None:
    threshold = 0.3
    best, best_score = None, -1.0
    for e in odds_events:
        hs = team_similarity(e["home_team"], home_team)
        aws = team_similarity(e["away_team"], away_team)
        if hs >= threshold and aws >= threshold and hs + aws > best_score:
            best_score, best = hs + aws, e
    return best


def extract_bookmaker_lines(event: dict) -> list[dict]:
    """Détail brut par bookmaker — la fiabilité (médiane, écart entre
    bookmakers) est calculée à l'analyse (par Claude Code), pas ici, pour
    que cette fonction reste une collecte pure sans décision."""
    lines = []
    for bm in event.get("bookmakers", []):
        entry = {"bookmaker": bm["key"], "h2h": {}, "totals": [], "spreads": {}}
        for market in bm.get("markets", []):
            if market["key"] == "h2h":
                for o in market["outcomes"]:
                    if o["name"] == event["home_team"]:
                        entry["h2h"]["home"] = o["price"]
                    elif o["name"] == event["away_team"]:
                        entry["h2h"]["away"] = o["price"]
                    elif o["name"].lower() == "draw":
                        entry["h2h"]["draw"] = o["price"]
            elif market["key"] == "totals":
                for o in market["outcomes"]:
                    if o.get("point") is None:
                        continue
                    side = "over" if "over" in o["name"].lower() else "under"
                    entry["totals"].append({"point": o["point"], "side": side, "price": o["price"]})
            elif market["key"] == "spreads":
                for o in market["outcomes"]:
                    if o.get("point") is None:
                        continue
                    if o["name"] == event["home_team"]:
                        entry["spreads"]["home_point"] = o["point"]
                        entry["spreads"]["home_price"] = o["price"]
                    elif o["name"] == event["away_team"]:
                        entry["spreads"]["away_point"] = o["point"]
                        entry["spreads"]["away_price"] = o["price"]
        lines.append(entry)
    return lines


# ── Serper (actualités) ──────────────────────────────────────────────────

def search_news(query: str, num: int = 3) -> list[dict]:
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        return []
    res = requests.post(
        "https://google.serper.dev/news",
        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        json={"q": query, "num": num, "gl": "fr", "hl": "fr"},
        timeout=15,
    )
    if not res.ok:
        return []
    return res.json().get("news", [])[:num]


def check_team_news(team_name: str) -> str:
    results = search_news(f"{team_name} blessure suspension forfait", 3)
    if not results:
        return "Aucune actualité notable détectée."
    return " | ".join(f"[{r.get('source', 'Source')}] {r.get('title')}: {r.get('snippet')}" for r in results)


# ── Orchestration ────────────────────────────────────────────────────────

def main() -> None:
    date = sys.argv[1] if len(sys.argv) > 1 else datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"Collecte des données pour le {date}...")

    odds_events = get_today_odds(date)
    print(f"  {len(odds_events)} événements de cotes récupérés")

    mode = "complet"
    matches: list[dict] = []
    try:
        matches = get_today_matches(date)[:MAX_MATCHES]
    except Exception as err:  # noqa: BLE001 — on veut dégrader proprement, pas planter
        print(f"[warn] API-Football indisponible ({err}) — mode cotes seules", file=sys.stderr)
        mode = "cotes_seules"

    result_matches = []

    if mode == "complet" and matches:
        history_cache: dict[int, list[dict]] = {}
        for i, m in enumerate(matches):
            print(f"  Match {i + 1}/{len(matches)} : {m['home_team']['name']} vs {m['away_team']['name']}")
            for team in (m["home_team"], m["away_team"]):
                if team["id"] not in history_cache:
                    history_cache[team["id"]] = get_team_history(team["id"])

            odds_event = find_match_odds(odds_events, m["home_team"]["name"], m["away_team"]["name"])

            result_matches.append({
                "competition": m["competition"],
                "home_team": m["home_team"]["name"],
                "away_team": m["away_team"]["name"],
                "home_team_logo": m["home_team"]["logo"],
                "away_team_logo": m["away_team"]["logo"],
                "datetime": m["datetime"],
                "home_history": history_cache[m["home_team"]["id"]],
                "away_history": history_cache[m["away_team"]["id"]],
                "bookmaker_lines": extract_bookmaker_lines(odds_event) if odds_event else [],
                "home_news": check_team_news(m["home_team"]["name"]),
                "away_news": check_team_news(m["away_team"]["name"]),
            })
    else:
        # Sans API-Football pour recadrer la sélection, on se limite aux
        # championnats reconnaissables (voir is_known_league).
        known = [e for e in odds_events if is_known_league(e.get("sport_key", ""))][:20]
        for e in known:
            result_matches.append({
                "competition": e.get("sport_title", ""),
                "home_team": e["home_team"],
                "away_team": e["away_team"],
                "home_team_logo": None,
                "away_team_logo": None,
                "datetime": e["commence_time"],
                "home_history": [],
                "away_history": [],
                "bookmaker_lines": extract_bookmaker_lines(e),
                "home_news": check_team_news(e["home_team"]),
                "away_news": check_team_news(e["away_team"]),
            })

    output = {
        "date": date,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "rules": {
            "min_trend_pct": 80,
            "min_sample": 8,
            "min_odds": 1.35,
            "max_odds": 6.0,
            "max_bookmaker_spread_pct": 20,
            "tier_pick_range": {"prudent": [2, 4], "equilibre": [5, 8], "audacieux": [8, 15]},
        },
        "matches": result_matches,
    }

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"collected_{date}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ {len(result_matches)} matchs collectés (mode {mode}) → {out_path}")
    print("Étape suivante : demande à Claude Code de lire ce fichier et de composer le(s) combiné(s).")


if __name__ == "__main__":
    main()
