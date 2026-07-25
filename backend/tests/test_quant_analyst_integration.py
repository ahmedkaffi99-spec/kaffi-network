"""Test d'intégration du moteur quantitatif (agents/quant_analyst.py) —
mêmes principes que tests/test_orchestrator_integration.py : les frontières
externes (API-Football, Understat, cotes bookmaker) sont remplacées par de
faux appels déterministes, le vrai code (force Poisson/Dixon-Coles,
simulation Monte Carlo, détection de value bet) est exercé tel quel."""
import pytest

import agents.quant_analyst as quant_analyst
from quant.value_bet import ValueBet
from tools.football_api import MatchAnalysisData, TeamMatchResult, TeamRef, TodayMatch
from tools.odds_api import BookmakerQuote


def _history(goals_for_seq: list[int], goals_against_seq: list[int], opponent: str) -> list[TeamMatchResult]:
    return [
        TeamMatchResult(
            date=f"2024-0{(i % 9) + 1}-01T00:00:00Z",
            opponent=opponent,
            home=(i % 2 == 0),
            goals_for=gf,
            goals_against=ga,
            total_goals=gf + ga,
            result="W" if gf > ga else ("D" if gf == ga else "L"),
        )
        for i, (gf, ga) in enumerate(zip(goals_for_seq, goals_against_seq))
    ]


def _fixture() -> MatchAnalysisData:
    match = TodayMatch(
        id=1,
        competition="Premier League",
        home_team=TeamRef(id=1, name="StrongFC", logo=""),
        away_team=TeamRef(id=2, name="WeakFC", logo=""),
        datetime="2026-08-01T15:00:00Z",
    )
    # StrongFC marque beaucoup, encaisse peu ; WeakFC l'inverse.
    home_history = _history([3, 2, 3, 2, 3, 2], [0, 1, 0, 1, 0, 1], opponent="Various")
    away_history = _history([0, 1, 0, 1, 0, 1], [3, 2, 3, 2, 3, 2], opponent="Various")
    return MatchAnalysisData(match=match, home_team_last_matches=home_history, away_team_last_matches=away_history)


@pytest.fixture(autouse=True)
def _patch_external_boundaries(monkeypatch):
    async def fake_get_today_matches(_date=None):
        return [_fixture().match]

    async def fake_build_match_analysis_data(_matches):
        return [_fixture()]

    async def fake_get_understat_team_stats(_team_name, _competition, _season=None):
        return None  # simule Understat indisponible — le modèle retombe sur les buts réels seuls

    async def fake_get_bookmaker_quotes(home_team, _away_team, bet_type):
        # Cote "Victoire domicile" volontairement sous-évaluée par rapport à
        # la vraie force de StrongFC pour garantir un value bet détectable.
        if bet_type == "Victoire domicile":
            return [BookmakerQuote(bookmaker="1xbet", price=2.5)]
        if bet_type == "Victoire extérieur":
            return [BookmakerQuote(bookmaker="1xbet", price=1.5)]
        return [BookmakerQuote(bookmaker="1xbet", price=1.9)]

    async def fake_get_oddspapi_price(*_args, **_kwargs):
        # Simule OddsPapi indisponible/sans cette sélection — force le repli
        # sur The Odds API (fake_get_bookmaker_quotes ci-dessus), même
        # scénario que le mode de repli réel (voir _resolve_bookmaker_odds).
        return None

    monkeypatch.setattr(quant_analyst, "get_today_matches", fake_get_today_matches)
    monkeypatch.setattr(quant_analyst, "build_match_analysis_data", fake_build_match_analysis_data)
    monkeypatch.setattr(quant_analyst, "get_understat_team_stats", fake_get_understat_team_stats)
    monkeypatch.setattr(quant_analyst, "get_bookmaker_quotes", fake_get_bookmaker_quotes)
    monkeypatch.setattr(quant_analyst, "get_oddspapi_price", fake_get_oddspapi_price)


@pytest.mark.asyncio
async def test_run_quant_analysis_detects_value_bet_on_underpriced_favorite():
    value_bets = await quant_analyst.run_quant_analysis(date="2026-08-01")

    assert len(value_bets) > 0
    assert all(isinstance(vb, ValueBet) for vb in value_bets)

    home_win_bets = [vb for vb in value_bets if vb.selection == "Victoire domicile"]
    assert home_win_bets, "value bet attendu sur la victoire du favori sous-coté"
    assert home_win_bets[0].edge > 0
    assert home_win_bets[0].model_prob > home_win_bets[0].implied_prob


@pytest.mark.asyncio
async def test_run_quant_analysis_sorted_by_confidence_descending():
    value_bets = await quant_analyst.run_quant_analysis(date="2026-08-01")
    confidences = [vb.confidence for vb in value_bets]
    assert confidences == sorted(confidences, reverse=True)


@pytest.mark.asyncio
async def test_run_quant_analysis_no_matches_returns_empty(monkeypatch):
    async def fake_no_matches(_date=None):
        return []

    monkeypatch.setattr(quant_analyst, "get_today_matches", fake_no_matches)
    result = await quant_analyst.run_quant_analysis(date="2026-08-01")
    assert result == []


@pytest.mark.asyncio
async def test_oddspapi_price_takes_priority_over_the_odds_api(monkeypatch):
    """Quand OddsPapi a une cote pour la sélection, elle doit être utilisée
    (et sans écart entre bookmakers, puisqu'une seule source) plutôt que
    The Odds API — voir _resolve_bookmaker_odds."""

    async def fake_get_oddspapi_price(_home, _away, **_kwargs):
        return 3.0  # cote distincte de celle de The Odds API (2.5), pour distinguer les deux sources

    async def fake_get_bookmaker_quotes_should_not_be_used(*_args, **_kwargs):
        raise AssertionError("The Odds API ne devrait pas être appelé quand OddsPapi répond déjà")

    monkeypatch.setattr(quant_analyst, "get_oddspapi_price", fake_get_oddspapi_price)
    monkeypatch.setattr(quant_analyst, "get_bookmaker_quotes", fake_get_bookmaker_quotes_should_not_be_used)

    value_bets = await quant_analyst.run_quant_analysis(date="2026-08-01")
    home_win_bets = [vb for vb in value_bets if vb.selection == "Victoire domicile"]
    assert home_win_bets
    assert home_win_bets[0].bookmaker_odds == 3.0
    assert home_win_bets[0].bookmaker_spread_pct is None
