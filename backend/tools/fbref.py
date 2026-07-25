"""Scraping FBref (gratuit, sans clé API) — Progressive Passes, Progressive
Carries, et Actions Créatrices de Tir/But (SCA/GCA) par équipe.

FBref ne publie pas les "Big Chances"/"Big Chances Missed" au sens Opta
(propriétaire, non gratuit) — le proxy gratuit le plus proche est le nombre
d'Actions Créatrices de Tir (SCA) et de But (GCA), utilisé ici comme
approximation explicitement documentée, pas comme un remplacement exact.
PPDA et Deep Completions viennent déjà d'Understat (tools/understat.py),
qui les fournit tels quels — pas besoin de les reconstruire ici.

FBref cache certaines tables de statistiques dans des commentaires HTML
(<!-- ... -->) pour décourager le scraping basique — technique de
contournement standard dans la communauté open-source (utilisée par ex. par
les paquets `soccerdata`, `ScraperFC`) : on extrait le HTML des commentaires
avant de le parser normalement.

Comme tools/understat.py, cette fonction n'a pas pu être testée contre le
vrai site depuis cet environnement (accès réseau restreint) — à valider en
local. Fail-closed : toute erreur renvoie un résultat vide plutôt que
d'inventer des chiffres.
"""
import re
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup, Comment

from tools.odds_api import team_similarity

BASE_URL = "https://fbref.com"

# Identifiants de compétition FBref — mêmes 5 grands championnats européens
# que tools/understat.py::LEAGUE_SLUGS (FBref ne couvre pas non plus les
# compétitions internationales de la même façon qu'un championnat national).
COMPETITION_PATHS = {
    "premier league": "9/Premier-League-Stats",
    "la liga": "12/La-Liga-Stats",
    "laliga": "12/La-Liga-Stats",
    "serie a": "11/Serie-A-Stats",
    "bundesliga": "20/Bundesliga-Stats",
    "ligue 1": "13/Ligue-1-Stats",
}


def fbref_competition_path(competition_name: str) -> str | None:
    return COMPETITION_PATHS.get(competition_name.strip().lower())


@dataclass
class FbrefTeamStats:
    team: str
    matches_played: int
    progressive_passes: float | None = None
    progressive_passes_per_match: float | None = None
    progressive_carries: float | None = None
    progressive_carries_per_match: float | None = None
    # Actions Créatrices de Tir/But — proxy gratuit le plus proche des "big
    # chances" (données Opta non disponibles gratuitement).
    shot_creating_actions_per_match: float | None = None
    goal_creating_actions_per_match: float | None = None


def _uncomment_tables(html: str) -> str:
    """FBref planque certaines tables dans des commentaires HTML — les
    réinjecter dans le document avant parsing (BeautifulSoup ignore le
    contenu des commentaires par défaut)."""
    soup = BeautifulSoup(html, "lxml")
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        if "<table" in comment:
            comment.replace_with(BeautifulSoup(comment, "lxml"))
    return str(soup)


def _cell_float(row, stat: str) -> float | None:
    cell = row.find(attrs={"data-stat": stat})
    if cell is None or not cell.text.strip():
        return None
    try:
        return float(cell.text.strip().replace(",", ""))
    except ValueError:
        return None


def _team_name(row) -> str | None:
    cell = row.find(attrs={"data-stat": "team"})
    if cell is None:
        return None
    # Le nom d'équipe est parfois dans un <a>, parfois texte brut direct.
    link = cell.find("a")
    return (link.text if link else cell.text).strip()


def _parse_squad_table(soup: BeautifulSoup, table_id: str, stat_fields: list[str]) -> dict[str, dict[str, float | None]]:
    table = soup.find("table", id=table_id)
    if table is None:
        return {}

    body = table.find("tbody")
    if body is None:
        return {}

    result: dict[str, dict[str, float | None]] = {}
    for row in body.find_all("tr"):
        team = _team_name(row)
        if not team:
            continue
        result[team] = {stat: _cell_float(row, stat) for stat in stat_fields}

    return result


async def get_league_team_stats(competition_path: str) -> dict[str, FbrefTeamStats]:
    """Statistiques saison (Progressive Passes/Carries, SCA/GCA) de toutes
    les équipes d'un championnat. Renvoie un dict vide si FBref est
    indisponible ou si la structure de la page a changé."""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{BASE_URL}/en/comps/{competition_path}", timeout=20.0, headers={"User-Agent": "Mozilla/5.0"})
            if not res.is_success:
                return {}
            html = res.text
    except httpx.HTTPError:
        return {}

    try:
        full_html = _uncomment_tables(html)
        soup = BeautifulSoup(full_html, "lxml")
    except Exception:
        return {}

    passing = _parse_squad_table(soup, "stats_squads_passing_for", ["games", "progressive_passes"])
    possession = _parse_squad_table(soup, "stats_squads_possession_for", ["progressive_carries"])
    gca = _parse_squad_table(soup, "stats_squads_gca_for", ["sca_per90", "gca_per90"])

    teams = set(passing) | set(possession) | set(gca)
    result: dict[str, FbrefTeamStats] = {}

    for team in teams:
        p = passing.get(team, {})
        c = possession.get(team, {})
        g = gca.get(team, {})

        matches = int(p.get("games") or 0)
        prog_passes = p.get("progressive_passes")
        prog_carries = c.get("progressive_carries")

        result[team] = FbrefTeamStats(
            team=team,
            matches_played=matches,
            progressive_passes=prog_passes,
            progressive_passes_per_match=round(prog_passes / matches, 2) if prog_passes is not None and matches else None,
            progressive_carries=prog_carries,
            progressive_carries_per_match=round(prog_carries / matches, 2) if prog_carries is not None and matches else None,
            shot_creating_actions_per_match=g.get("sca_per90"),
            goal_creating_actions_per_match=g.get("gca_per90"),
        )

    return result


def find_team_stats(team_name: str, league_stats: dict[str, FbrefTeamStats]) -> FbrefTeamStats | None:
    threshold = 0.3
    best, best_score = None, -1.0
    for title, stats in league_stats.items():
        score = team_similarity(title, team_name)
        if score >= threshold and score > best_score:
            best_score, best = score, stats
    return best


async def get_team_stats(team_name: str, competition_name: str) -> FbrefTeamStats | None:
    path = fbref_competition_path(competition_name)
    if not path:
        return None

    league_stats = await get_league_team_stats(path)
    if not league_stats:
        return None

    return find_team_stats(team_name, league_stats)
