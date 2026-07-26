"""Moteur quantitatif — Elo, Poisson/Dixon-Coles, Monte Carlo, Value Bet/Kelly
sur les marchés 1X2, BTTS, Over/Under (voir backend/README.md, section
"Moteur quantitatif" pour le contexte complet et ses limites connues).

Entièrement déterministe — aucun appel modèle (LLM), donc pas de
Blackboard/RunBudget ici (ce framework existe pour borner le raisonnement
d'un LLM, pas un calcul numérique). Alternative à agents/analyst.py pour
ces 3 marchés précis, PAS ENCORE câblée dans orchestrator.py par défaut :
remplacer agents/analyst.py par ce module dans le pipeline de production
(qui alimente un vrai canal Telegram) mérite d'abord d'être validé
manuellement en comparant ses sorties à des sessions connues (voir
backend/README.md).

Limite de données assumée : la force offensive/défensive de chaque équipe
est estimée à partir de SON PROPRE historique récent (tools/football_api.py,
~15 derniers matchs), pas d'un ajustement Dixon-Coles joint sur tout un
championnat (quant/poisson_model.py::fit_dixon_coles_mle existe pour ce cas
mais a besoin d'un jeu de données bien plus large que ce que la collecte
actuelle rassemble par run).
"""
from dataclasses import dataclass
from statistics import mean

from quant.elo import EloRatingBook
from quant.monte_carlo import DEFAULT_N_SIMULATIONS, simulate_match
from quant.poisson_model import (
    DEFAULT_LEAGUE_AVG_GOALS,
    DEFAULT_RHO,
    TeamStrength,
    blended_goals,
    estimate_team_strength_simple,
    expected_goals,
)
from quant.types import HistoricalMatch
from quant.value_bet import ValueBet, build_value_bet, find_value_bets
from tools import thesportsdb
from tools.football_api import (
    H2HMatch,
    MatchAnalysisData,
    TeamMatchResult,
    TeamRef,
    TodayMatch,
    build_match_analysis_data,
    get_today_matches,
)
from tools.football_api import get_head_to_head as get_af_head_to_head
from tools.football_api import get_team_history as get_af_team_history
from tools.football_api import search_team as search_af_team
from tools.oddspapi import MARKET_TYPE_1X2
from tools.oddspapi import get_bookmaker_price as get_oddspapi_price
from tools.odds_api import PRIORITY_BOOKMAKER_KEY, get_bookmaker_quotes
from tools.understat import get_team_stats as get_understat_team_stats

# Edge minimum pour qu'un pari soit retenu comme "value bet" — même ordre
# de grandeur que les seuils déjà en place dans le pipeline heuristique
# (voir agents/odds_selector.py::MAX_BOOKMAKER_SPREAD pour un seuil de même
# nature, sur les cotes plutôt que sur l'edge).
MIN_EDGE = 0.02
# En dessous, l'historique d'une équipe est jugé trop court pour qu'une
# force attaque/défense estimée soit exploitable.
MIN_HISTORY_FOR_STRENGTH = 5

OVER_UNDER_SELECTIONS = {
    0.5: ("Plus de 0.5 buts", "Moins de 0.5 buts"),
    1.5: ("Plus de 1.5 buts", "Moins de 1.5 buts"),
    2.5: ("Plus de 2.5 buts", "Moins de 2.5 buts"),
    3.5: ("Plus de 3.5 buts", "Moins de 3.5 buts"),
    4.5: ("Plus de 4.5 buts", "Moins de 4.5 buts"),
}


def _history_to_goal_lists(history: list[TeamMatchResult], xg_per_match: float | None) -> tuple[list[float], list[float]]:
    """Mélange chaque match réel à la moyenne saison xG de l'équipe (aucun
    appariement match par match nécessaire — voir le docstring du module) :
    un lissage vers une estimation plus stable de la qualité sous-jacente,
    plutôt qu'un calcul brut sur des buts réels bruyants match par match."""
    goals_for = [blended_goals(m.goals_for, xg_per_match) for m in history]
    goals_against = [blended_goals(m.goals_against, None) for m in history]
    return goals_for, goals_against


async def _team_strength(team_name: str, competition: str, history: list[TeamMatchResult], league_avg_goals: float) -> tuple[TeamStrength, int]:
    understat_stats = await get_understat_team_stats(team_name, competition)
    xg_per_match = understat_stats.xg_per_match if understat_stats else None

    goals_for, goals_against = _history_to_goal_lists(history, xg_per_match)
    strength = estimate_team_strength_simple(goals_for, goals_against, league_avg_goals)
    return strength, len(history)


def _league_avg_goals(analysis_data: list[MatchAnalysisData]) -> float:
    all_goals = [
        m.goals_for
        for data in analysis_data
        for m in (*data.home_team_last_matches, *data.away_team_last_matches)
    ]
    return mean(all_goals) if all_goals else DEFAULT_LEAGUE_AVG_GOALS


def _team_history_to_matches(team_name: str, history: list[TeamMatchResult]) -> list[HistoricalMatch]:
    """Reconstruit chaque match passé avec le VRAI adversaire (`m.opponent`)
    et la bonne orientation domicile/extérieur — nécessaire pour un replay
    Elo correct (voir quant/elo.py::EloRatingBook.replay_history)."""
    matches = []
    for m in history:
        if m.home:
            matches.append(HistoricalMatch(home_team=team_name, away_team=m.opponent, home_goals=m.goals_for, away_goals=m.goals_against, date=m.date))
        else:
            matches.append(HistoricalMatch(home_team=m.opponent, away_team=team_name, home_goals=m.goals_against, away_goals=m.goals_for, date=m.date))
    return matches


def _build_elo_book(analysis_data: list[MatchAnalysisData]) -> EloRatingBook:
    """Un seul EloRatingBook partagé sur tout le run — rejoue l'historique de
    toutes les équipes analysées. Dédoublonné par (domicile, extérieur,
    date) : deux équipes analysées dans la même passe peuvent chacune
    renvoyer leur même confrontation passée dans leur propre historique."""
    all_matches: dict[tuple[str, str, str], HistoricalMatch] = {}

    for data in analysis_data:
        home_name, away_name = data.match.home_team.name, data.match.away_team.name
        for m in (*_team_history_to_matches(home_name, data.home_team_last_matches), *_team_history_to_matches(away_name, data.away_team_last_matches)):
            all_matches[(m.home_team, m.away_team, m.date)] = m

    book = EloRatingBook()
    book.replay_history(list(all_matches.values()))
    return book


def _market_probabilities(mc) -> list[tuple[str, str, float]]:
    probs = [
        ("1X2", "Victoire domicile", mc.home_win_prob),
        ("1X2", "Match nul", mc.draw_prob),
        ("1X2", "Victoire extérieur", mc.away_win_prob),
        ("BTTS", "BTTS Oui", mc.btts_yes_prob),
        ("BTTS", "BTTS Non", mc.btts_no_prob),
    ]
    for line, (over_label, under_label) in OVER_UNDER_SELECTIONS.items():
        line_probs = mc.over_under_probs.get(line)
        if not line_probs:
            continue
        probs.append(("Over/Under", over_label, line_probs["over"]))
        probs.append(("Over/Under", under_label, line_probs["under"]))
    return probs


def _oddspapi_query_for(market: str, selection: str) -> dict:
    """Traduit un couple (marché, sélection) du vocabulaire du moteur (voir
    _market_probabilities ci-dessus) vers les critères de recherche OddsPapi
    (market_type/market_name, handicap, sélection). Renvoie {} pour un
    marché non reconnu — l'appelant retombe alors directement sur The Odds
    API."""
    if market == "1X2":
        selection_map = {"Victoire domicile": "1", "Match nul": "X", "Victoire extérieur": "2"}
        return {"market_type": MARKET_TYPE_1X2, "selection": selection_map[selection]}
    if market == "BTTS":
        return {"market_name": "Both Teams To Score", "selection": "Yes" if selection == "BTTS Oui" else "No"}
    if market == "Over/Under":
        is_over = selection.startswith("Plus de")
        line = float(selection.split(" ")[2])
        return {"market_name": "Over Under Full Time", "handicap": line, "selection": "Over" if is_over else "Under"}
    return {}


async def _resolve_bookmaker_odds(home_team: str, away_team: str, market: str, selection: str) -> tuple[float, float | None] | None:
    """(cote retenue, écart entre bookmakers en %) — OddsPapi en priorité
    (plus riche, couvre beaucoup plus de matchs/marchés, voir
    tools/oddspapi.py), repli sur The Odds API (tools/odds_api.py, même
    logique de priorité que agents/odds_selector.py::_select_reliable_odds :
    1xBet en priorité, sinon médiane) si OddsPapi n'a pas cette sélection.
    OddsPapi ne renvoie ici qu'un seul bookmaker (1xBet) — pas d'écart entre
    bookmakers calculable depuis cette source (spread_pct=None, traité comme
    neutre par quant/value_bet.py::confidence_score)."""
    oddspapi_query = _oddspapi_query_for(market, selection)
    if oddspapi_query:
        price = await get_oddspapi_price(home_team, away_team, **oddspapi_query)
        if price is not None:
            return price, None

    quotes = await get_bookmaker_quotes(home_team, away_team, selection)
    if not quotes:
        return None

    prices = [q.price for q in quotes]
    lo, hi = min(prices), max(prices)
    spread_pct = ((hi - lo) / lo) * 100 if lo else None

    priority = next((q for q in quotes if q.bookmaker == PRIORITY_BOOKMAKER_KEY), None)
    if priority:
        return priority.price, spread_pct

    sorted_prices = sorted(prices)
    n = len(sorted_prices)
    mid = n // 2
    median_price = (sorted_prices[mid - 1] + sorted_prices[mid]) / 2 if n % 2 == 0 else sorted_prices[mid]
    return median_price, spread_pct


async def _analyze_teams(
    home_name: str,
    away_name: str,
    competition: str,
    match_datetime: str,
    home_history: list[TeamMatchResult],
    away_history: list[TeamMatchResult],
    league_avg_goals: float,
    elo_rating_gap: float | None,
) -> list[ValueBet]:
    """Cœur partagé entre analyze_fixture (historique déjà résolu via une
    affiche API-Football du jour) et analyze_named_fixture (historique
    résolu par nom, voir _resolve_team_history) : force Poisson/Dixon-Coles,
    simulation Monte Carlo (100 000 tirages), puis comparaison de chaque
    probabilité de marché à la cote bookmaker réellement disponible."""
    home_strength, home_n = await _team_strength(home_name, competition, home_history, league_avg_goals)
    away_strength, away_n = await _team_strength(away_name, competition, away_history, league_avg_goals)
    sample_size = min(home_n, away_n)

    lam, mu = expected_goals(home_strength, away_strength, league_avg_goals)
    mc = simulate_match(lam, mu, DEFAULT_RHO, n_simulations=DEFAULT_N_SIMULATIONS)

    value_bets: list[ValueBet] = []
    for market, selection, model_prob in _market_probabilities(mc):
        resolved = await _resolve_bookmaker_odds(home_name, away_name, market, selection)
        if not resolved:
            continue
        odds, spread_pct = resolved

        value_bets.append(
            build_value_bet(
                home_team=home_name,
                away_team=away_name,
                competition=competition,
                match_datetime=match_datetime,
                market=market,
                selection=selection,
                model_prob=model_prob,
                bookmaker_odds=odds,
                sample_size=sample_size,
                bookmaker_spread_pct=spread_pct,
                odds_only_mode=False,
                elo_rating_gap=elo_rating_gap,
            )
        )

    return value_bets


async def analyze_fixture(data: MatchAnalysisData, league_avg_goals: float, elo_book: EloRatingBook | None = None) -> list[ValueBet]:
    """Analyse une affiche déjà résolue par API-Football (voir
    build_match_analysis_data) — nécessite que la découverte du jour
    (get_today_matches) ait fonctionné, donc limité à la fenêtre de dates
    autorisée par le plan API-Football (voir analyze_named_fixture pour
    analyser une affiche à une date plus lointaine)."""
    match = data.match
    home_name, away_name = match.home_team.name, match.away_team.name

    if len(data.home_team_last_matches) < MIN_HISTORY_FOR_STRENGTH or len(data.away_team_last_matches) < MIN_HISTORY_FOR_STRENGTH:
        return []

    elo_rating_gap = elo_book.rating_gap(home_name, away_name) if elo_book is not None else None

    return await _analyze_teams(
        home_name, away_name, match.competition, match.datetime,
        data.home_team_last_matches, data.away_team_last_matches,
        league_avg_goals, elo_rating_gap,
    )


async def analyze_fixtures(matches: list[TodayMatch]) -> list[ValueBet]:
    """Analyse une liste précise d'affiches DÉJÀ CONNUES d'API-Football (pas
    nécessairement "tout le calendrier du jour") — utilisé par
    run_quant_analysis ci-dessous. Respecte déjà le rate limit 7s/appel et le
    plafond MAX_MATCHES_TO_ANALYZE de
    tools/football_api.py::build_match_analysis_data.

    Limité à la fenêtre de dates que le plan API-Football autorise pour
    `/fixtures?date=` (get_today_matches) — pour une affiche à une date plus
    lointaine (ex: dans un mois), voir analyze_named_fixtures ci-dessous, qui
    résout chaque équipe par nom plutôt que par date."""
    analysis_data = await build_match_analysis_data(matches)
    if not analysis_data:
        return []

    league_avg_goals = _league_avg_goals(analysis_data)
    # Un seul book Elo partagé sur tout le lot, construit une fois à partir
    # de l'historique déjà collecté pour toutes les affiches analysées (pas
    # de nouvel appel API-Football supplémentaire).
    elo_book = _build_elo_book(analysis_data)

    all_value_bets: list[ValueBet] = []
    for data in analysis_data:
        all_value_bets.extend(await analyze_fixture(data, league_avg_goals, elo_book))

    return find_value_bets(all_value_bets, min_edge=MIN_EDGE)


async def run_quant_analysis(date: str | None = None) -> list[ValueBet]:
    """Point d'entrée — tout le calendrier du jour (voir analyze_fixtures ci-
    dessus pour analyser une liste précise d'affiches à la place)."""
    matches = await get_today_matches(date)
    if not matches:
        return []

    return await analyze_fixtures(matches)


async def _resolve_team_history(team_name: str, limit: int = 15) -> tuple[list[TeamMatchResult], TeamRef | None]:
    """Historique récent d'une équipe résolu par NOM — pas par une affiche du
    jour découverte via `/fixtures?date=` (restreint à une fenêtre proche
    d'aujourd'hui par le plan gratuit API-Football, voir
    tools/football_api.py::get_today_matches). API-Football en priorité
    (historique complet, domicile/extérieur séparé, via search_team +
    get_team_history), TheSportsDB en repli (tools/thesportsdb.py) si
    l'équipe est introuvable ou le quota API-Football épuisé — jamais
    d'exception non attrapée, une source indisponible ne bloque jamais
    l'autre.

    Renvoie aussi le TeamRef résolu par API-Football (None si seul
    TheSportsDB a répondu, ou si aucune source n'a l'équipe) — permet à
    l'appelant de réutiliser cet ID pour le head-to-head (get_head_to_head)
    sans refaire un search_team, qui coûterait une requête rate-limitée
    supplémentaire pour rien."""
    try:
        team_ref = await search_af_team(team_name)
        if team_ref:
            history = await get_af_team_history(team_ref.id, limit)
            if history:
                return history, team_ref
    except Exception as err:
        print(f"[quant_analyst] API-Football indisponible pour {team_name} : {err}")

    fallback = await thesportsdb.get_team_history(team_name, limit)
    return fallback or [], None


@dataclass
class FixtureDiagnostics:
    """Données brutes derrière le calcul d'une affiche — les 5 derniers
    matchs de chaque équipe et leurs 5 dernières confrontations directes —
    pour que l'utilisateur puisse vérifier visuellement la donnée avant de
    faire confiance au résultat (voir scripts/analyze_specific_matches.py)."""
    home_team: str
    away_team: str
    home_last_5: list[TeamMatchResult]
    away_last_5: list[TeamMatchResult]
    h2h_last_5: list[H2HMatch]


async def analyze_named_fixture_detailed(
    home_team: str, away_team: str, competition: str, match_datetime: str
) -> tuple[list[ValueBet], FixtureDiagnostics]:
    """Comme analyze_named_fixture, mais renvoie aussi les données brutes
    (FixtureDiagnostics) utilisées pour le calcul — voir
    scripts/analyze_specific_matches.py pour l'affichage détaillé."""
    home_history, home_ref = await _resolve_team_history(home_team)
    away_history, away_ref = await _resolve_team_history(away_team)

    h2h: list[H2HMatch] = []
    if home_ref is not None and away_ref is not None:
        try:
            h2h = await get_af_head_to_head(home_ref.id, away_ref.id, limit=5)
        except Exception as err:
            print(f"[quant_analyst] Head-to-head indisponible pour {home_team} vs {away_team} : {err}")

    diagnostics = FixtureDiagnostics(
        home_team=home_team,
        away_team=away_team,
        home_last_5=home_history[:5],
        away_last_5=away_history[:5],
        h2h_last_5=h2h,
    )

    if len(home_history) < MIN_HISTORY_FOR_STRENGTH or len(away_history) < MIN_HISTORY_FOR_STRENGTH:
        print(
            f"[quant_analyst] Historique insuffisant pour {home_team} vs {away_team} "
            f"({len(home_history)}/{len(away_history)} matchs, minimum {MIN_HISTORY_FOR_STRENGTH}) — affiche ignorée."
        )
        return [], diagnostics

    all_goals = [m.goals_for for m in (*home_history, *away_history)]
    league_avg_goals = mean(all_goals) if all_goals else DEFAULT_LEAGUE_AVG_GOALS

    elo_book = EloRatingBook()
    elo_book.replay_history(
        [*_team_history_to_matches(home_team, home_history), *_team_history_to_matches(away_team, away_history)]
    )
    elo_rating_gap = elo_book.rating_gap(home_team, away_team)

    value_bets = await _analyze_teams(
        home_team, away_team, competition, match_datetime,
        home_history, away_history, league_avg_goals, elo_rating_gap,
    )
    return value_bets, diagnostics


async def analyze_named_fixture(home_team: str, away_team: str, competition: str, match_datetime: str) -> list[ValueBet]:
    """Analyse UNE affiche identifiée par nom d'équipe — pas besoin de la
    découvrir via API-Football `/fixtures?date=` (voir _resolve_team_history),
    donc utilisable pour n'importe quelle date, même dans plusieurs semaines/
    mois. Voir scripts/analyze_specific_matches.py pour un exemple d'usage."""
    value_bets, _diagnostics = await analyze_named_fixture_detailed(home_team, away_team, competition, match_datetime)
    return value_bets


async def analyze_named_fixtures(fixtures: list[tuple[str, str, str, str]]) -> list[ValueBet]:
    """fixtures : liste de (home_team, away_team, competition, match_datetime).
    Point d'entrée pour scripts/analyze_specific_matches.py — découverte des
    affiches indépendante de la fenêtre de dates d'API-Football (voir
    analyze_named_fixture)."""
    all_value_bets: list[ValueBet] = []
    for home_team, away_team, competition, match_datetime in fixtures:
        all_value_bets.extend(await analyze_named_fixture(home_team, away_team, competition, match_datetime))

    return find_value_bets(all_value_bets, min_edge=MIN_EDGE)


async def analyze_named_fixtures_detailed(
    fixtures: list[tuple[str, str, str, str]]
) -> tuple[list[ValueBet], list[FixtureDiagnostics]]:
    """Comme analyze_named_fixtures, mais renvoie aussi la liste des
    FixtureDiagnostics (une par affiche, même ordre) — voir
    scripts/analyze_specific_matches.py pour l'affichage "20 équipes une par
    une, 5 derniers matchs + head-to-head"."""
    all_value_bets: list[ValueBet] = []
    all_diagnostics: list[FixtureDiagnostics] = []
    for home_team, away_team, competition, match_datetime in fixtures:
        value_bets, diagnostics = await analyze_named_fixture_detailed(home_team, away_team, competition, match_datetime)
        all_value_bets.extend(value_bets)
        all_diagnostics.append(diagnostics)

    return find_value_bets(all_value_bets, min_edge=MIN_EDGE), all_diagnostics
