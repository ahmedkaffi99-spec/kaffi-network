"""TheSportsDB (https://www.thesportsdb.com) — second filet pour l'historique
d'une équipe quand API-Football n'a rien trouvé (quota épuisé, équipe
introuvable) ou n'est pas utilisable (voir tools/football_api.py::get_today_matches
pour la restriction de date du plan gratuit).

Port adapté (async/httpx) de la logique déjà validée en production par
l'utilisateur dans son script `collecte_donnees.py` (bet_agent) —
`trouver_stats_thesportsdb`. Clé de test publique "3", documentée par
TheSportsDB, sans inscription ni coût.

Contrairement à la note du script d'origine ("pas de séparation domicile/
extérieur possible"), ce port conserve la vraie séparation domicile/
extérieur par match (l'API la fournit bel et bien via idHomeTeam/
idAwayTeam) — juste un choix d'agrégation différent de l'original, pas une
limite réelle de la source.
"""
import httpx

from .football_api import TeamMatchResult
from .odds_api import team_similarity

BASE_URL = "https://www.thesportsdb.com/api/v1/json/3"

# En dessous, l'échantillon est jugé trop bruyant pour être exploitable —
# même seuil que bet_agent (NB_MATCHS_MIN_THESPORTSDB).
MIN_MATCHES = 3

# Le quota (30 req/min) est PARTAGÉ mondialement par tous les utilisateurs de
# cette clé de test — un espacement entre appels réduit le risque de 429
# sans l'éliminer complètement (voir bet_agent/collecte_donnees.py).
_REQUEST_DELAY_SECONDS = 2.5


async def _search_team(name: str) -> tuple[str, str] | None:
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{BASE_URL}/searchteams.php", params={"t": name}, timeout=10.0)
            if not res.is_success:
                return None
            teams = res.json().get("teams") or []
    except httpx.HTTPError:
        return None

    if not teams:
        return None

    best, best_score = None, -1.0
    for t in teams:
        score = team_similarity(t.get("strTeam", ""), name)
        if score > best_score:
            best_score, best = score, t

    if best_score < 0.3 or best is None:
        return None

    return best["idTeam"], best["strTeam"]


async def get_team_history(team_name: str, limit: int = 15) -> list[TeamMatchResult] | None:
    """Historique récent d'une équipe (derniers matchs terminés, séparation
    domicile/extérieur incluse) — None si l'équipe est introuvable ou si
    l'échantillon est trop petit (< MIN_MATCHES) pour être exploitable."""
    found = await _search_team(team_name)
    if not found:
        return None
    team_id, _official_name = found

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{BASE_URL}/eventslast.php", params={"id": team_id}, timeout=10.0)
            if not res.is_success:
                return None
            events = res.json().get("results") or []
    except httpx.HTTPError:
        return None

    history: list[TeamMatchResult] = []
    for e in events:
        home_score, away_score = e.get("intHomeScore"), e.get("intAwayScore")
        if home_score is None or away_score is None:
            continue

        is_home = e.get("idHomeTeam") == team_id
        gf = int(home_score) if is_home else int(away_score)
        ga = int(away_score) if is_home else int(home_score)
        opponent = (e.get("strAwayTeam") if is_home else e.get("strHomeTeam")) or "?"
        result = "W" if gf > ga else ("D" if gf == ga else "L")

        history.append(
            TeamMatchResult(
                date=e.get("dateEvent") or "",
                opponent=opponent,
                home=is_home,
                goals_for=gf,
                goals_against=ga,
                total_goals=gf + ga,
                result=result,
            )
        )

    # MIN_MATCHES est vérifié sur le total de matchs valables disponibles,
    # PAS sur le résultat tronqué à `limit` — sinon un appelant demandant
    # volontairement un petit échantillon (limit < MIN_MATCHES) recevrait
    # toujours None même avec largement assez de données réelles.
    if len(history) < MIN_MATCHES:
        return None

    return history[:limit]
