from tools.result_checker import _evaluate_result


def test_over_2_5_win():
    assert _evaluate_result("Plus de 2.5 buts", "A", "B", 2, 1) == "win"


def test_over_2_5_loss():
    assert _evaluate_result("Plus de 2.5 buts", "A", "B", 1, 1) == "loss"


def test_under_1_5_win():
    assert _evaluate_result("Moins de 1.5 buts", "A", "B", 1, 0) == "win"


def test_btts_oui_win():
    assert _evaluate_result("BTTS Oui", "A", "B", 1, 1) == "win"


def test_btts_non_loss():
    assert _evaluate_result("BTTS Non", "A", "B", 1, 1) == "loss"


def test_victoire_domicile_win():
    assert _evaluate_result("Victoire domicile", "A", "B", 2, 0) == "win"


def test_victoire_exterieur_loss():
    assert _evaluate_result("Victoire extérieur", "A", "B", 2, 0) == "loss"


def test_match_nul_win():
    assert _evaluate_result("Match nul", "A", "B", 1, 1) == "win"


def test_handicap_home_covers():
    # Domicile -1 : doit gagner par 2+ buts d'écart pour couvrir.
    assert _evaluate_result("Handicap Real Madrid -1", "Real Madrid", "Sevilla", 3, 1) == "win"


def test_handicap_home_push_is_void():
    assert _evaluate_result("Handicap Real Madrid -1", "Real Madrid", "Sevilla", 2, 1) == "void"


def test_handicap_unknown_team_is_void():
    assert _evaluate_result("Handicap Racing Club -1", "Real Madrid", "Sevilla", 3, 0) == "void"


def test_unrecognized_bet_type_is_void():
    assert _evaluate_result("Corner total impair", "A", "B", 1, 1) == "void"
