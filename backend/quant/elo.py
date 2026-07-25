"""Modèle Elo — force des équipes.

Port du système "World Football Elo Ratings" (eloratings.net), la
référence académique/publique la plus documentée pour le football : avantage
du terrain fixe, K-factor fixe (compétitions de club, pas de majoration
Coupe du Monde), et un multiplicateur d'écart de buts G qui fait qu'une
victoire large pèse plus qu'une victoire 1-0.

Le rating Elo sert de signal de force d'équipe (affiché dans l'explication
des value bets) — les probabilités de marché (1X2, BTTS, Over/Under)
viennent du modèle Poisson/Dixon-Coles + Monte Carlo (quant/poisson_model.py,
quant/monte_carlo.py), pas d'une conversion directe d'Elo en probabilité
(qui serait arbitraire sans données empiriques pour la calibrer).
"""
from dataclasses import dataclass

from .types import HistoricalMatch

DEFAULT_RATING = 1500.0
# K=20 — valeur standard pour des matchs de club (le système eloratings.net
# utilise des K plus élevés pour les grandes compétitions internationales,
# non pertinent ici).
DEFAULT_K = 20.0
# ~100 points — estimation usuelle de l'avantage du terrain en football de
# club (World Football Elo Ratings utilise une valeur similaire au niveau
# international).
DEFAULT_HOME_ADVANTAGE = 100.0


@dataclass
class EloUpdateResult:
    home_rating_before: float
    away_rating_before: float
    home_rating_after: float
    away_rating_after: float
    expected_home_score: float
    rating_change: float


def goal_diff_multiplier(goal_diff: int) -> float:
    """G — une victoire plus large déplace davantage le rating qu'une
    victoire courte, mais avec des rendements décroissants (formule
    World Football Elo Ratings)."""
    diff = abs(goal_diff)
    if diff <= 1:
        return 1.0
    if diff == 2:
        return 1.5
    return (11 + diff) / 8


def expected_score(rating_home: float, rating_away: float, home_advantage: float = DEFAULT_HOME_ADVANTAGE) -> float:
    """Probabilité/score attendu du domicile (échelle Elo logistique
    standard, base 10 / 400 points) — 1.0 = victoire certaine, 0.5 = match
    équilibré, 0.0 = défaite certaine."""
    rating_diff = (rating_home + home_advantage) - rating_away
    return 1.0 / (10 ** (-rating_diff / 400) + 1)


def update_ratings(
    rating_home: float,
    rating_away: float,
    home_goals: int,
    away_goals: int,
    k: float = DEFAULT_K,
    home_advantage: float = DEFAULT_HOME_ADVANTAGE,
) -> EloUpdateResult:
    we = expected_score(rating_home, rating_away, home_advantage)
    goal_diff = home_goals - away_goals
    actual = 1.0 if goal_diff > 0 else (0.5 if goal_diff == 0 else 0.0)
    change = k * goal_diff_multiplier(goal_diff) * (actual - we)

    return EloUpdateResult(
        home_rating_before=rating_home,
        away_rating_before=rating_away,
        home_rating_after=rating_home + change,
        away_rating_after=rating_away - change,
        expected_home_score=we,
        rating_change=change,
    )


class EloRatingBook:
    """Garde les ratings Elo de toutes les équipes rencontrées, calibrés en
    rejouant un historique de matchs dans l'ordre chronologique. Les équipes
    jamais vues démarrent à `initial_rating` (aucun biais favorable/défavorable)."""

    def __init__(
        self,
        initial_rating: float = DEFAULT_RATING,
        k: float = DEFAULT_K,
        home_advantage: float = DEFAULT_HOME_ADVANTAGE,
    ) -> None:
        self.initial_rating = initial_rating
        self.k = k
        self.home_advantage = home_advantage
        self._ratings: dict[str, float] = {}

    def get(self, team: str) -> float:
        return self._ratings.get(team, self.initial_rating)

    def record_match(self, home_team: str, away_team: str, home_goals: int, away_goals: int) -> EloUpdateResult:
        result = update_ratings(self.get(home_team), self.get(away_team), home_goals, away_goals, self.k, self.home_advantage)
        self._ratings[home_team] = result.home_rating_after
        self._ratings[away_team] = result.away_rating_after
        return result

    def replay_history(self, matches: list[HistoricalMatch]) -> None:
        """Rejoue `matches` dans l'ordre chronologique (le tri est fait ici,
        l'appelant peut fournir les matchs dans n'importe quel ordre)."""
        for match in sorted(matches, key=lambda m: m.date):
            self.record_match(match.home_team, match.away_team, match.home_goals, match.away_goals)

    def rating_gap(self, home_team: str, away_team: str) -> float:
        """Écart de rating (avantage terrain inclus) — positif en faveur du
        domicile. Purement informatif (affiché dans l'explication d'un
        value bet), n'alimente aucun calcul de probabilité de marché."""
        return (self.get(home_team) + self.home_advantage) - self.get(away_team)
