from quant.value_bet import (
    build_value_bet,
    confidence_score,
    edge,
    expected_value,
    find_value_bets,
    implied_probability,
    kelly_fraction,
    star_rating,
)


def test_implied_probability():
    assert abs(implied_probability(2.5) - 0.4) < 1e-9


def test_implied_probability_zero_odds_is_zero():
    assert implied_probability(0) == 0.0


def test_edge_positive_when_model_more_confident_than_market():
    assert abs(edge(0.5, 0.4) - 0.1) < 1e-9


def test_expected_value_matches_formula():
    assert abs(expected_value(0.5, 2.5) - 0.25) < 1e-9


def test_kelly_fraction_positive_edge():
    k = kelly_fraction(0.5, 2.5, kelly_multiplier=0.25)
    assert 0 < k <= 0.25


def test_kelly_fraction_no_edge_is_zero():
    assert kelly_fraction(0.4, 2.5) == 0.0


def test_kelly_fraction_negative_edge_is_zero_not_negative():
    assert kelly_fraction(0.3, 2.5) == 0.0


def test_kelly_fraction_respects_max_cap():
    k = kelly_fraction(0.9, 10.0, kelly_multiplier=1.0, max_fraction=0.25)
    assert k == 0.25


def test_confidence_score_increases_with_edge():
    low = confidence_score(0.02, sample_size=15, bookmaker_spread_pct=2.0)
    high = confidence_score(0.15, sample_size=15, bookmaker_spread_pct=2.0)
    assert high > low


def test_confidence_score_odds_only_mode_penalty():
    with_data = confidence_score(0.1, sample_size=15, bookmaker_spread_pct=2.0, odds_only_mode=False)
    odds_only = confidence_score(0.1, sample_size=15, bookmaker_spread_pct=2.0, odds_only_mode=True)
    assert odds_only < with_data


def test_confidence_score_bounded_0_100():
    assert 0 <= confidence_score(10.0, sample_size=1000, bookmaker_spread_pct=0.0) <= 100


def test_star_rating_tiers():
    assert star_rating(95) == ("Exceptionnel", 5)
    assert star_rating(80) == ("Très bon", 4)
    assert star_rating(65) == ("Bon", 3)
    assert star_rating(50) == ("Moyen", 2)
    assert star_rating(10) == ("Faible", 1)


def test_build_value_bet_end_to_end():
    vb = build_value_bet(
        home_team="Real Madrid",
        away_team="Sevilla",
        competition="La Liga",
        match_datetime="2026-08-01T20:00:00Z",
        market="1X2",
        selection="Victoire domicile",
        model_prob=0.55,
        bookmaker_odds=2.1,
        sample_size=15,
        bookmaker_spread_pct=3.0,
    )
    assert vb.edge > 0
    assert vb.star_count in {1, 2, 3, 4, 5}


def test_find_value_bets_filters_by_min_edge_and_sorts_by_confidence():
    high_edge = build_value_bet("A", "B", "L", "d", "1X2", "sel", model_prob=0.7, bookmaker_odds=2.0, sample_size=15, bookmaker_spread_pct=1.0)
    low_edge = build_value_bet("C", "D", "L", "d", "1X2", "sel", model_prob=0.52, bookmaker_odds=2.0, sample_size=15, bookmaker_spread_pct=1.0)
    no_edge = build_value_bet("E", "F", "L", "d", "1X2", "sel", model_prob=0.3, bookmaker_odds=2.0, sample_size=15, bookmaker_spread_pct=1.0)

    result = find_value_bets([high_edge, low_edge, no_edge], min_edge=0.02)

    assert no_edge not in result
    assert result[0] == high_edge
