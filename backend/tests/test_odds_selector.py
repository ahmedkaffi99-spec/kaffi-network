from agents.odds_selector import (
    MIN_PICKS_PER_COMBO,
    TIER_PICK_RANGE,
    _compose_tiers,
    _interleave_from_both_ends,
    _match_key,
    _take_unique_by_match,
)


def _pick(i: int, odds: float) -> dict:
    return {"home_team": f"Home{i}", "away_team": f"Away{i}", "bet_type": "Plus de 2.5 buts", "odds": odds}


def test_take_unique_by_match_dedupes_same_match():
    picks = [_pick(1, 1.5), {**_pick(1, 1.6), "bet_type": "BTTS Oui"}, _pick(2, 1.7)]
    result = _take_unique_by_match(picks, 5)
    assert len({_match_key(p) for p in result}) == len(result)
    assert len(result) == 2  # un seul pick retenu pour le match 1, malgré 2 candidats


def test_interleave_alternates_low_and_high():
    picks_asc = [_pick(i, 1.3 + i * 0.1) for i in range(6)]
    result = _interleave_from_both_ends(picks_asc, 4)
    odds_taken = [p["odds"] for p in result]
    # Alterne bas (1.3) puis haut (1.8) puis bas (1.4) puis haut (1.7)...
    assert odds_taken[0] == picks_asc[0]["odds"]
    assert odds_taken[1] == picks_asc[-1]["odds"]


def test_compose_tiers_below_minimum_skips_tier():
    reliable = [_pick(i, 1.4 + i * 0.1) for i in range(MIN_PICKS_PER_COMBO - 1)]
    composition = _compose_tiers(reliable)
    assert "prudent" not in composition["combos"]
    assert any(not d["included"] for d in composition["decisions"])


def test_compose_tiers_builds_all_three_with_enough_matches():
    # 10 matchs distincts — largement au-dessus des minimums (2/5/8).
    all_odds = [1.3 + i * 0.2 for i in range(10)]
    reliable = [_pick(i, odds) for i, odds in enumerate(all_odds)]
    composition = _compose_tiers(reliable)
    combos = composition["combos"]

    assert set(combos.keys()) == {"prudent", "equilibre", "audacieux"}
    for tier, combo in combos.items():
        rng = TIER_PICK_RANGE[tier]
        assert rng["min"] <= len(combo["picks"]) <= rng["max"]

    # prudent = les N cotes les plus basses (N = son plafond, 4 ici) ; audacieux
    # = les N' cotes les plus hautes (N' = min(son plafond 15, 10 matchs dispo)).
    sorted_odds = sorted(all_odds)
    prudent_count = min(TIER_PICK_RANGE["prudent"]["max"], len(all_odds))
    audacieux_count = min(TIER_PICK_RANGE["audacieux"]["max"], len(all_odds))
    assert sorted([p["odds"] for p in combos["prudent"]["picks"]]) == sorted_odds[:prudent_count]
    assert sorted([p["odds"] for p in combos["audacieux"]["picks"]]) == sorted_odds[-audacieux_count:]
