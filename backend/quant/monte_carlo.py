"""Simulation Monte Carlo — au moins 100 000 matchs simulés à partir de la
distribution Dixon-Coles (quant/poisson_model.py::score_matrix), pour
produire les probabilités de marché (1X2, BTTS, Over/Under) et les scores
exacts les plus probables.

Chaque tirage représente un match simulé (score domicile/extérieur) tiré
selon la grille de probabilité Dixon-Coles — pas une ré-application
indépendante de deux lois de Poisson (qui ignorerait la corrélation des
scores faibles). Les probabilités de marché sont les fréquences empiriques
observées sur les N tirages, pas une lecture directe de la grille fermée
(bien que les deux convergent l'une vers l'autre — voir
tests/test_monte_carlo.py pour la vérification de convergence)."""
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .poisson_model import score_matrix

DEFAULT_N_SIMULATIONS = 100_000
DEFAULT_MAX_GOALS = 10
# Lignes de Over/Under couramment proposées par les bookmakers — voir
# tools/odds_api.py (mêmes lignes que celles reconnues côté cotes).
OVER_UNDER_LINES = [0.5, 1.5, 2.5, 3.5, 4.5]


@dataclass
class MonteCarloResult:
    n_simulations: int
    home_win_prob: float
    draw_prob: float
    away_win_prob: float
    btts_yes_prob: float
    btts_no_prob: float
    # {2.5: {"over": 0.55, "under": 0.45}, ...}
    over_under_probs: dict[float, dict[str, float]] = field(default_factory=dict)
    expected_home_goals: float = 0.0
    expected_away_goals: float = 0.0
    # [((buts_domicile, buts_exterieur), probabilité), ...] triés par fréquence décroissante
    top_scorelines: list[tuple[tuple[int, int], float]] = field(default_factory=list)


def simulate_match(
    lam: float,
    mu: float,
    rho: float,
    n_simulations: int = DEFAULT_N_SIMULATIONS,
    max_goals: int = DEFAULT_MAX_GOALS,
    seed: int | None = None,
) -> MonteCarloResult:
    grid = score_matrix(lam, mu, rho, max_goals)
    flat_probs = grid.flatten()

    rng = np.random.default_rng(seed)
    flat_indices = rng.choice(flat_probs.size, size=n_simulations, p=flat_probs)
    home_goals_sim, away_goals_sim = np.unravel_index(flat_indices, grid.shape)

    home_win_prob = float(np.mean(home_goals_sim > away_goals_sim))
    draw_prob = float(np.mean(home_goals_sim == away_goals_sim))
    away_win_prob = float(np.mean(home_goals_sim < away_goals_sim))

    btts_yes_prob = float(np.mean((home_goals_sim > 0) & (away_goals_sim > 0)))

    total_goals_sim = home_goals_sim + away_goals_sim
    over_under_probs = {}
    for line in OVER_UNDER_LINES:
        over = float(np.mean(total_goals_sim > line))
        over_under_probs[line] = {"over": round(over, 4), "under": round(1 - over, 4)}

    counter = Counter(zip(home_goals_sim.tolist(), away_goals_sim.tolist()))
    top_scorelines = [(score, round(count / n_simulations, 4)) for score, count in counter.most_common(5)]

    return MonteCarloResult(
        n_simulations=n_simulations,
        home_win_prob=round(home_win_prob, 4),
        draw_prob=round(draw_prob, 4),
        away_win_prob=round(away_win_prob, 4),
        btts_yes_prob=round(btts_yes_prob, 4),
        btts_no_prob=round(1 - btts_yes_prob, 4),
        over_under_probs=over_under_probs,
        expected_home_goals=round(float(home_goals_sim.mean()), 3),
        expected_away_goals=round(float(away_goals_sim.mean()), 3),
        top_scorelines=top_scorelines,
    )
