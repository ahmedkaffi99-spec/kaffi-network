import json
from datetime import datetime, timezone

from tools.understat import (
    _aggregate_season_stats,
    _extract_script_var,
    _parse_team_history,
    current_understat_season,
    find_team_stats,
    understat_league_slug,
)


def _build_fake_html(payload: dict) -> str:
    raw_json = json.dumps(payload, ensure_ascii=False)
    # Simule l'échappement \xHH byte-par-byte utilisé par Understat.
    escaped = "".join(f"\\x{b:02x}" for b in raw_json.encode("utf-8"))
    return f"<script>var teamsData = JSON.parse('{escaped}');</script>"


FAKE_PAYLOAD = {
    "1": {
        "title": "Liverpool",
        "history": [
            {
                "h_a": "h", "scored": "3", "missed": "0", "xG": "2.10", "xGA": "0.45",
                "deep": "9", "deep_allowed": "2",
                "ppda": {"att": 150, "def": 25}, "ppda_allowed": {"att": 100, "def": 20},
                "xpts": "2.70", "result": "w", "date": "2024-08-13 16:30:00",
            },
            {
                "h_a": "a", "scored": "1", "missed": "1", "xG": "1.30", "xGA": "1.10",
                "deep": "5", "deep_allowed": "4",
                "ppda": {"att": 140, "def": 28}, "ppda_allowed": {"att": 90, "def": 18},
                "xpts": "1.40", "result": "d", "date": "2024-08-20 16:30:00",
            },
        ],
    }
}


def test_understat_league_slug_known_competition():
    assert understat_league_slug("Premier League") == "EPL"
    assert understat_league_slug("premier league") == "EPL"


def test_understat_league_slug_unknown_competition():
    assert understat_league_slug("Champions League") is None


def test_current_understat_season_is_a_4_digit_year():
    season = current_understat_season()
    assert len(season) == 4
    assert int(season) <= datetime.now(timezone.utc).year


def test_decode_and_extract_script_var_roundtrip():
    html = _build_fake_html(FAKE_PAYLOAD)
    decoded = _extract_script_var(html, "teamsData")
    assert decoded is not None
    assert decoded["1"]["title"] == "Liverpool"


def test_extract_script_var_missing_variable_returns_none():
    html = "<script>var somethingElse = JSON.parse('\\x7b\\x7d');</script>"
    assert _extract_script_var(html, "teamsData") is None


def test_parse_team_history_extracts_ppda_ratio():
    history = _parse_team_history(FAKE_PAYLOAD["1"]["history"])
    assert len(history) == 2
    assert history[0].goals_for == 3
    assert history[0].ppda_for == 6.0  # 150/25
    assert history[1].is_home is False


def test_aggregate_season_stats_sums_correctly():
    history = _parse_team_history(FAKE_PAYLOAD["1"]["history"])
    stats = _aggregate_season_stats("Liverpool", history)
    assert stats.matches == 2
    assert stats.xg_total == 3.4
    assert stats.xga_total == 1.55


def test_find_team_stats_fuzzy_matches_team_name():
    history = _parse_team_history(FAKE_PAYLOAD["1"]["history"])
    stats = _aggregate_season_stats("Liverpool", history)
    league_stats = {"Liverpool": stats}

    assert find_team_stats("Liverpool FC", league_stats) is stats
    assert find_team_stats("Chelsea", league_stats) is None
