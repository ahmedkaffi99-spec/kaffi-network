from quant.elo import EloRatingBook, expected_score, goal_diff_multiplier, update_ratings


def test_home_advantage_favors_home_at_equal_rating():
    we = expected_score(1500, 1500)
    assert 0.5 < we < 0.7


def test_big_underdog_at_home_has_low_expected_score():
    we = expected_score(1300, 1700)
    assert we < 0.3


def test_goal_diff_multiplier_increases_with_margin():
    assert goal_diff_multiplier(1) == 1.0
    assert goal_diff_multiplier(2) == 1.5
    assert goal_diff_multiplier(3) > goal_diff_multiplier(2)


def test_update_ratings_home_win_increases_home_rating():
    result = update_ratings(1500, 1500, 3, 0)
    assert result.rating_change > 0
    assert result.home_rating_after > 1500
    assert result.away_rating_after < 1500


def test_update_ratings_draw_at_equal_rating_is_a_letdown_for_home():
    # Le domicile est légèrement favori (avantage du terrain) — un match nul
    # est donc un résultat légèrement décevant, le rating home doit baisser.
    result = update_ratings(1500, 1500, 1, 1)
    assert result.rating_change < 0


def test_rating_book_replays_history_in_chronological_order():
    book = EloRatingBook()
    book.replay_history([])  # ne doit pas planter sur une liste vide
    assert book.get("Unknown Team") == book.initial_rating

    book.record_match("A", "B", 2, 0)
    assert book.get("A") > book.get("B")


def test_rating_gap_includes_home_advantage():
    book = EloRatingBook()
    gap_equal_ratings = book.rating_gap("New", "Team")
    assert gap_equal_ratings == book.home_advantage
