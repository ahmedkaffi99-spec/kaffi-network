import numpy as np

from quant.poisson_model import (
    DEFAULT_RHO,
    TeamStrength,
    blended_goals,
    dixon_coles_tau,
    estimate_team_strength_simple,
    expected_goals,
    expected_goals_from_model,
    fit_dixon_coles_mle,
    score_matrix,
)
from quant.types import HistoricalMatch


def test_blended_goals_without_xg_returns_actual():
    assert blended_goals(2, None) == 2.0


def test_blended_goals_averages_actual_and_xg():
    assert blended_goals(2, 1.0, xg_weight=0.5) == 1.5


def test_dixon_coles_tau_only_adjusts_low_scores():
    assert dixon_coles_tau(0, 0, 1.5, 1.1, -0.13) == 1 - 1.5 * 1.1 * (-0.13)
    assert dixon_coles_tau(2, 2, 1.5, 1.1, -0.13) == 1.0
    assert dixon_coles_tau(5, 3, 1.5, 1.1, -0.13) == 1.0


def test_score_matrix_sums_to_one():
    grid = score_matrix(1.5, 1.1, DEFAULT_RHO, max_goals=10)
    assert abs(grid.sum() - 1.0) < 1e-9


def test_estimate_team_strength_simple_ratio_to_league_average():
    strength = estimate_team_strength_simple([2.8], [1.4], league_avg_goals=1.4)
    assert strength.attack == 2.0
    assert strength.defense == 1.0


def test_estimate_team_strength_simple_handles_empty_history():
    strength = estimate_team_strength_simple([], [], league_avg_goals=1.4)
    assert strength.attack == 1.0
    assert strength.defense == 1.0


def test_expected_goals_stronger_home_attack_yields_higher_lambda():
    strong = TeamStrength(attack=2.0, defense=0.5)
    weak = TeamStrength(attack=0.5, defense=2.0)
    lam, mu = expected_goals(strong, weak, league_avg_goals=1.4)
    assert lam > mu


def test_fit_dixon_coles_mle_requires_minimum_sample():
    import pytest

    with pytest.raises(ValueError):
        fit_dixon_coles_mle([HistoricalMatch(home_team="A", away_team="B", home_goals=1, away_goals=0, date="2024-01-01T00:00:00Z")])


def test_fit_dixon_coles_mle_recovers_strength_ordering():
    rng = np.random.default_rng(42)
    true_attack = {"Strong": 1.8, "Mid1": 1.0, "Mid2": 1.0, "Weak": 0.4}
    true_defense = {"Strong": 0.5, "Mid1": 1.0, "Mid2": 1.0, "Weak": 1.8}
    home_adv, league_avg = 1.3, 1.3
    teams = list(true_attack.keys())

    matches = []
    counter = 0
    for _ in range(30):
        for h in teams:
            for a in teams:
                if h == a:
                    continue
                lam = league_avg * true_attack[h] * true_defense[a] * home_adv
                mu = league_avg * true_attack[a] * true_defense[h]
                counter += 1
                matches.append(
                    HistoricalMatch(
                        home_team=h,
                        away_team=a,
                        home_goals=int(rng.poisson(lam)),
                        away_goals=int(rng.poisson(mu)),
                        date=f"2024-01-{(counter % 28) + 1:02d}T00:00:00Z",
                    )
                )

    model = fit_dixon_coles_mle(matches)

    assert model.teams["Strong"].attack > model.teams["Weak"].attack
    assert model.teams["Strong"].defense < model.teams["Weak"].defense

    lam, mu = expected_goals_from_model(model, "Strong", "Weak")
    assert lam > mu * 3
