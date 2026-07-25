"""Scraping Understat (gratuit, sans clé API) — xG, xGA, xPoints, PPDA,
Deep Completions par équipe et par match.

Understat n'expose pas d'API publique : les pages de championnat embarquent
les données sous forme de JSON dans une balise <script>, technique bien
documentée et utilisée depuis des années par la communauté open-source de
l'analyse football (ex: paquets `understat`, `soccerdata`). Cette fonction
n'a PAS pu être testée contre le vrai site depuis cet environnement de
développement (accès réseau restreint dans ce sandbox) — à valider avec de
vraies clés/un vrai accès une fois en local (voir backend/README.md).

Fail-closed : toute erreur de scraping (site indisponible, structure HTML
changée, équipe introuvable) renvoie None plutôt que d'inventer des
statistiques — cohérent avec le reste du projet (voir agent_kernel/json_utils.py).
"""
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from tools.odds_api import team_similarity

BASE_URL = "https://understat.com"

# Slugs Understat pour les championnats couverts par le reste du pipeline
# (voir tools/odds_api.py::KNOWN_LEAGUE_SPORT_KEYS) — Understat ne couvre
# que les 5 grands championnats européens + RFPL, pas les compétitions
# internationales/continentales (Champions League, Coupe du Monde...).
LEAGUE_SLUGS = {
    "premier league": "EPL",
    "la liga": "La_liga",
    "laliga": "La_liga",
    "serie a": "Serie_A",
    "bundesliga": "Bundesliga",
    "ligue 1": "Ligue_1",
}


def understat_league_slug(competition_name: str) -> str | None:
    return LEAGUE_SLUGS.get(competition_name.strip().lower())


def current_understat_season() -> str:
    """Understat nomme une saison par son année de démarrage (ex: la saison
    2024-2025 est "2024") — août à décembre = année en cours, janvier à
    juillet = année précédente (intersaison/fin de saison)."""
    now = datetime.now(timezone.utc)
    return str(now.year if now.month >= 8 else now.year - 1)


@dataclass
class UnderstatMatchStat:
    date: str
    is_home: bool
    goals_for: int
    goals_against: int
    xg_for: float
    xg_against: float
    deep_completions_for: int
    deep_completions_against: int
    ppda_for: float | None
    ppda_against: float | None
    xpoints: float
    result: str  # 'w' | 'd' | 'l'


@dataclass
class UnderstatTeamSeasonStats:
    team: str
    matches: int
    xg_total: float
    xga_total: float
    xg_per_match: float
    xga_per_match: float
    deep_completions_per_match: float
    deep_completions_against_per_match: float
    ppda: float | None  # moyenne saison — passes adverses avant action défensive (bas = pressing haut)
    ppda_allowed: float | None
    xpoints_total: float
    history: list[UnderstatMatchStat] = field(default_factory=list)


def _decode_understat_json(raw: str) -> object | None:
    """Le JSON est échappé en JS via des séquences \\xHH — décodage standard
    utilisé par la communauté open-source pour lire les pages Understat."""
    try:
        decoded = raw.encode("utf-8").decode("unicode_escape").encode("latin1").decode("utf8")
        return json.loads(decoded)
    except (UnicodeDecodeError, UnicodeEncodeError, json.JSONDecodeError):
        return None


def _extract_script_var(html: str, var_name: str) -> object | None:
    match = re.search(rf"var\s+{re.escape(var_name)}\s*=\s*JSON\.parse\('(.+?)'\);", html)
    if not match:
        return None
    return _decode_understat_json(match.group(1))


def _ppda_ratio(ppda: dict | None) -> float | None:
    if not ppda:
        return None
    att, defn = ppda.get("att"), ppda.get("def")
    if not att or not defn:
        return None
    return round(att / defn, 2)


def _parse_team_history(raw_history: list[dict]) -> list[UnderstatMatchStat]:
    parsed = []
    for entry in raw_history:
        try:
            parsed.append(
                UnderstatMatchStat(
                    date=entry["date"],
                    is_home=entry["h_a"] == "h",
                    goals_for=int(entry["scored"]),
                    goals_against=int(entry["missed"]),
                    xg_for=float(entry["xG"]),
                    xg_against=float(entry["xGA"]),
                    deep_completions_for=int(entry.get("deep", 0)),
                    deep_completions_against=int(entry.get("deep_allowed", 0)),
                    ppda_for=_ppda_ratio(entry.get("ppda")),
                    ppda_against=_ppda_ratio(entry.get("ppda_allowed")),
                    xpoints=float(entry.get("xpts", 0)),
                    result=entry["result"],
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return parsed


def _aggregate_season_stats(team_title: str, history: list[UnderstatMatchStat]) -> UnderstatTeamSeasonStats:
    n = len(history) or 1
    ppda_values = [m.ppda_for for m in history if m.ppda_for is not None]
    ppda_allowed_values = [m.ppda_against for m in history if m.ppda_against is not None]

    return UnderstatTeamSeasonStats(
        team=team_title,
        matches=len(history),
        xg_total=round(sum(m.xg_for for m in history), 2),
        xga_total=round(sum(m.xg_against for m in history), 2),
        xg_per_match=round(sum(m.xg_for for m in history) / n, 2),
        xga_per_match=round(sum(m.xg_against for m in history) / n, 2),
        deep_completions_per_match=round(sum(m.deep_completions_for for m in history) / n, 2),
        deep_completions_against_per_match=round(sum(m.deep_completions_against for m in history) / n, 2),
        ppda=round(sum(ppda_values) / len(ppda_values), 2) if ppda_values else None,
        ppda_allowed=round(sum(ppda_allowed_values) / len(ppda_allowed_values), 2) if ppda_allowed_values else None,
        xpoints_total=round(sum(m.xpoints for m in history), 2),
        history=history,
    )


async def get_league_team_stats(league_slug: str, season: str | None = None) -> dict[str, UnderstatTeamSeasonStats]:
    """Statistiques saison de toutes les équipes d'un championnat. Renvoie un
    dict vide (jamais une exception) si Understat est indisponible ou si la
    structure de la page a changé — l'appelant doit traiter ça comme
    "données avancées indisponibles", pas comme une erreur bloquante."""
    season = season or current_understat_season()

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{BASE_URL}/league/{league_slug}/{season}", timeout=20.0, headers={"User-Agent": "Mozilla/5.0"})
            if not res.is_success:
                return {}
            html = res.text
    except httpx.HTTPError:
        return {}

    raw_teams_data = _extract_script_var(html, "teamsData")
    if not isinstance(raw_teams_data, dict):
        return {}

    result: dict[str, UnderstatTeamSeasonStats] = {}
    for team_entry in raw_teams_data.values():
        title = team_entry.get("title")
        raw_history = team_entry.get("history")
        if not title or not isinstance(raw_history, list):
            continue
        history = _parse_team_history(raw_history)
        result[title] = _aggregate_season_stats(title, history)

    return result


def find_team_stats(team_name: str, league_stats: dict[str, UnderstatTeamSeasonStats]) -> UnderstatTeamSeasonStats | None:
    """Fait correspondre un nom d'équipe (venant d'API-Football) à une entrée
    Understat par similarité de noms — les deux sources n'utilisent pas
    toujours exactement la même orthographe (ex: "Man United" vs
    "Manchester United")."""
    threshold = 0.3
    best, best_score = None, -1.0
    for title, stats in league_stats.items():
        score = team_similarity(title, team_name)
        if score >= threshold and score > best_score:
            best_score, best = score, stats
    return best


async def get_team_stats(team_name: str, competition_name: str, season: str | None = None) -> UnderstatTeamSeasonStats | None:
    """Point d'entrée pratique — résout le championnat, récupère les stats
    de toute la ligue (mise en cache possible côté appelant sur une passe
    d'analyse), puis fait correspondre `team_name`. Renvoie None si le
    championnat n'est pas couvert par Understat ou si l'équipe est introuvable."""
    slug = understat_league_slug(competition_name)
    if not slug:
        return None

    league_stats = await get_league_team_stats(slug, season)
    if not league_stats:
        return None

    return find_team_stats(team_name, league_stats)
