from agents.supervisor import check_forbidden_words


def test_no_forbidden_words():
    assert check_forbidden_words("Une sélection ambitieuse, cote combinée 4.20.") == []


def test_detects_guaranteed_win_language():
    found = check_forbidden_words("Ce combiné est garanti à 100% de gagner, coup sûr !")
    assert "garanti" in found
    assert "coup sûr" in found


def test_detects_inappropriate_death_reference():
    assert "suicide" in check_forbidden_words("Un pari suicide mais qui peut payer gros.")


def test_case_insensitive():
    assert "infaillible" in check_forbidden_words("Une méthode INFAILLIBLE pour gagner.")
