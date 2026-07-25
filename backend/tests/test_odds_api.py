from tools.odds_api import team_similarity


def test_identical_names():
    assert team_similarity("Real Madrid", "Real Madrid") == 1.0


def test_common_abbreviation_stopwords_ignored():
    # "FC" est un stopword — ne doit pas gonfler artificiellement le score.
    assert team_similarity("Bayern Munich FC", "Bayern Munich") == 1.0


def test_partial_overlap():
    score = team_similarity("Manchester United", "Manchester City")
    assert 0 < score < 1


def test_no_overlap():
    assert team_similarity("Arsenal", "Chelsea") == 0.0


def test_empty_strings():
    assert team_similarity("", "") == 0.0
