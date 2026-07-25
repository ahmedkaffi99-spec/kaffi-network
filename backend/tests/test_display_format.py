from tools.display_format import shorten_bet_type


def test_over():
    assert shorten_bet_type("Plus de 2.5 buts") == "Over 2.5"


def test_under():
    assert shorten_bet_type("Moins de 1.5 buts") == "Under 1.5"


def test_btts_oui():
    assert shorten_bet_type("BTTS Oui") == "BTTS Oui"


def test_btts_non():
    assert shorten_bet_type("BTTS Non") == "BTTS Non"


def test_victoire_domicile():
    assert shorten_bet_type("Victoire domicile") == "1"


def test_victoire_exterieur():
    assert shorten_bet_type("Victoire extérieur") == "2"


def test_match_nul():
    assert shorten_bet_type("Match nul") == "X"


def test_handicap():
    assert shorten_bet_type("Handicap Real Madrid -1") == "Real Madrid -1"
