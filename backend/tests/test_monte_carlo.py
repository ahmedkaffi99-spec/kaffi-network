from quant.monte_carlo import simulate_match
from quant.poisson_model import score_matrix


def test_simulate_match_runs_at_least_100k_simulations_by_default():
    result = simulate_match(1.4, 1.1, -0.13, seed=1)
    assert result.n_simulations >= 100_000


def test_simulate_match_probabilities_sum_to_one():
    result = simulate_match(1.4, 1.1, -0.13, seed=1)
    total = result.home_win_prob + result.draw_prob + result.away_win_prob
    assert abs(total - 1.0) < 1e-3


def test_simulate_match_converges_to_closed_form_distribution():
    lam, mu, rho = 1.6, 1.1, -0.13
    result = simulate_match(lam, mu, rho, n_simulations=100_000, seed=7)

    grid = score_matrix(lam, mu, rho, max_goals=10)
    home_win_cf = sum(grid[i, j] for i in range(11) for j in range(11) if i > j)
    draw_cf = sum(grid[i, j] for i in range(11) for j in range(11) if i == j)
    away_win_cf = sum(grid[i, j] for i in range(11) for j in range(11) if i < j)

    # Marge de tolérance pour l'erreur d'échantillonnage Monte Carlo à 100k tirages.
    assert abs(result.home_win_prob - home_win_cf) < 0.01
    assert abs(result.draw_prob - draw_cf) < 0.01
    assert abs(result.away_win_prob - away_win_cf) < 0.01


def test_stronger_home_side_has_higher_win_probability_than_away():
    result = simulate_match(2.2, 0.8, -0.13, seed=3)
    assert result.home_win_prob > result.away_win_prob


def test_over_under_lines_are_monotonically_decreasing_in_over_probability():
    result = simulate_match(1.6, 1.3, -0.13, seed=5)
    lines = sorted(result.over_under_probs.keys())
    over_probs = [result.over_under_probs[line]["over"] for line in lines]
    assert over_probs == sorted(over_probs, reverse=True)


def test_top_scorelines_are_sorted_by_frequency_descending():
    result = simulate_match(1.4, 1.1, -0.13, seed=9)
    frequencies = [freq for _, freq in result.top_scorelines]
    assert frequencies == sorted(frequencies, reverse=True)
