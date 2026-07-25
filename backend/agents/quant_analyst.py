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
from tools.football_api import MatchAnalysisData, TeamMatchResult, build_match_analysis_data, get_today_matches
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


async def _resolve_bookmaker_odds(home_team: str, away_team: str, selection: str) -> tuple[float, float | None] | None:
    """(cote retenue, écart entre bookmakers en %) — même logique de
    priorité que agents/odds_selector.py::_select_reliable_odds (1xBet en
    priorité, sinon médiane), dupliquée ici en plus petit pour garder ce
    module autonome et testable sans dépendre de l'agent heuristique."""
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


async def analyze_fixture(data: MatchAnalysisData, league_avg_goals: float, elo_book: EloRatingBook | None = None) -> list[ValueBet]:
    """Analyse une affiche : force Poisson/Dixon-Coles des deux équipes,
    buts attendus, simulation Monte Carlo (100 000 tirages), puis
    comparaison de chaque probabilité de marché à la cote bookmaker
    réellement disponible pour détecter les value bets."""
    match = data.match
    home_name, away_name = match.home_team.name, match.away_team.name

    if len(data.home_team_last_matches) < MIN_HISTORY_FOR_STRENGTH or len(data.away_team_last_matches) < MIN_HISTORY_FOR_STRENGTH:
        return []

    home_strength, home_n = await _team_strength(home_name, match.competition, data.home_team_last_matches, league_avg_goals)
    away_strength, away_n = await _team_strength(away_name, match.competition, data.away_team_last_matches, league_avg_goals)
    sample_size = min(home_n, away_n)

    elo_rating_gap = elo_book.rating_gap(home_name, away_name) if elo_book is not None else None

    lam, mu = expected_goals(home_strength, away_strength, league_avg_goals)
    mc = simulate_match(lam, mu, DEFAULT_RHO, n_simulations=DEFAULT_N_SIMULATIONS)

    value_bets: list[ValueBet] = []
    for market, selection, model_prob in _market_probabilities(mc):
        resolved = await _resolve_bookmaker_odds(home_name, away_name, selection)
        if not resolved:
            continue
        odds, spread_pct = resolved

        value_bets.append(
            build_value_bet(
                home_team=home_name,
                away_team=away_name,
                competition=match.competition,
                match_datetime=match.datetime,
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


async def run_quant_analysis(date: str | None = None) -> list[ValueBet]:
    """Point d'entrée — matchs du jour, historique par équipe (réutilise
    tools/football_api.py::build_match_analysis_data, donc respecte déjà le
    rate limit 7s/appel et le plafond MAX_MATCHES_TO_ANALYZE), puis analyse
    de chaque affiche. Renvoie les value bets triés par score de confiance
    décroissant (quant/value_bet.py::find_value_bets)."""
    matches = await get_today_matches(date)
    if not matches:
        return []

    analysis_data = await build_match_analysis_data(matches)
    if not analysis_data:
        return []

    league_avg_goals = _league_avg_goals(analysis_data)
    # Un seul book Elo partagé sur tout le run, construit une fois à partir
    # de l'historique déjà collecté pour toutes les affiches analysées (pas
    # de nouvel appel API-Football supplémentaire).
    elo_book = _build_elo_book(analysis_data)

    all_value_bets: list[ValueBet] = []
    for data in analysis_data:
        all_value_bets.extend(await analyze_fixture(data, league_avg_goals, elo_book))

    return find_value_bets(all_value_bets, min_edge=MIN_EDGE)
