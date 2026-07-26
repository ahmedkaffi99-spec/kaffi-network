"""Test d'intégration du moteur quantitatif (agents/quant_analyst.py) —
mêmes principes que tests/test_orchestrator_integration.py : les frontières
externes (API-Football, Understat, cotes bookmaker) sont remplacées par de
faux appels déterministes, le vrai code (force Poisson/Dixon-Coles,
simulation Monte Carlo, détection de value bet) est exercé tel quel."""
import pytest

import agents.quant_analyst as quant_analyst
from quant.value_bet import ValueBet
from tools.football_api import H2HMatch, MatchAnalysisData, TeamMatchResult, TeamRef, TodayMatch
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


# ============================================================
# analyze_named_fixture(s) — résolution par nom, indépendante du calendrier
# API-Football (voir tools/football_api.py::get_today_matches, restreint à
# une fenêtre de dates proche d'aujourd'hui sur le plan gratuit).
# ============================================================


@pytest.mark.asyncio
async def test_analyze_named_fixture_uses_api_football_when_available(monkeypatch):
    strong_history = _history([3, 2, 3, 2, 3, 2], [0, 1, 0, 1, 0, 1], opponent="Various")
    weak_history = _history([0, 1, 0, 1, 0, 1], [3, 2, 3, 2, 3, 2], opponent="Various")

    async def fake_thesportsdb_get_team_history(*_args, **_kwargs):
        raise AssertionError("TheSportsDB ne devrait pas être appelé quand API-Football répond déjà")

    # team_id distingue StrongFC (id=1) de WeakFC (id=2), attribué dans
    # l'ordre d'appel de search_af_team (StrongFC toujours résolu en premier
    # par _resolve_team_history dans analyze_named_fixture).
    call_names: list[str] = []

    async def fake_search_af_team(name):
        call_names.append(name)
        return TeamRef(id=len(call_names), name=name, logo="")

    async def fake_get_af_team_history(team_id, _limit=15):
        return strong_history if team_id == 1 else weak_history

    async def fake_get_af_head_to_head(_team1_id, _team2_id, limit=5):
        return []

    monkeypatch.setattr(quant_analyst, "search_af_team", fake_search_af_team)
    monkeypatch.setattr(quant_analyst, "get_af_team_history", fake_get_af_team_history)
    monkeypatch.setattr(quant_analyst, "get_af_head_to_head", fake_get_af_head_to_head)
    monkeypatch.setattr(quant_analyst.thesportsdb, "get_team_history", fake_thesportsdb_get_team_history)

    value_bets = await quant_analyst.analyze_named_fixture("StrongFC", "WeakFC", "Premier League", "date non confirmée")

    home_win_bets = [vb for vb in value_bets if vb.selection == "Victoire domicile"]
    assert home_win_bets
    assert home_win_bets[0].edge > 0


@pytest.mark.asyncio
async def test_analyze_named_fixture_falls_back_to_thesportsdb(monkeypatch):
    strong_history = _history([3, 2, 3, 2, 3, 2], [0, 1, 0, 1, 0, 1], opponent="Various")
    weak_history = _history([0, 1, 0, 1, 0, 1], [3, 2, 3, 2, 3, 2], opponent="Various")

    async def fake_search_af_team(_name):
        return None  # API-Football ne trouve pas l'équipe (ou quota épuisé)

    async def fake_thesportsdb_get_team_history(name, _limit=15):
        return strong_history if name == "StrongFC" else weak_history

    monkeypatch.setattr(quant_analyst, "search_af_team", fake_search_af_team)
    monkeypatch.setattr(quant_analyst.thesportsdb, "get_team_history", fake_thesportsdb_get_team_history)

    value_bets = await quant_analyst.analyze_named_fixture("StrongFC", "WeakFC", "Premier League", "date non confirmée")

    home_win_bets = [vb for vb in value_bets if vb.selection == "Victoire domicile"]
    assert home_win_bets
    assert home_win_bets[0].edge > 0


@pytest.mark.asyncio
async def test_analyze_named_fixture_insufficient_history_returns_empty(monkeypatch):
    async def fake_search_af_team(_name):
        return None

    async def fake_thesportsdb_get_team_history(*_args, **_kwargs):
        return None  # aucune source n'a d'historique exploitable

    monkeypatch.setattr(quant_analyst, "search_af_team", fake_search_af_team)
    monkeypatch.setattr(quant_analyst.thesportsdb, "get_team_history", fake_thesportsdb_get_team_history)

    value_bets = await quant_analyst.analyze_named_fixture("Obscure FC", "Unknown United", "Premier League", "date non confirmée")
    assert value_bets == []


@pytest.mark.asyncio
async def test_analyze_named_fixtures_aggregates_and_sorts(monkeypatch):
    strong_history = _history([3, 2, 3, 2, 3, 2], [0, 1, 0, 1, 0, 1], opponent="Various")
    weak_history = _history([0, 1, 0, 1, 0, 1], [3, 2, 3, 2, 3, 2], opponent="Various")

    async def fake_search_af_team(_name):
        return None

    async def fake_thesportsdb_get_team_history(name, _limit=15):
        return strong_history if name == "StrongFC" else weak_history

    monkeypatch.setattr(quant_analyst, "search_af_team", fake_search_af_team)
    monkeypatch.setattr(quant_analyst.thesportsdb, "get_team_history", fake_thesportsdb_get_team_history)

    value_bets = await quant_analyst.analyze_named_fixtures(
        [
            ("StrongFC", "WeakFC", "Premier League", "date non confirmée"),
            ("StrongFC", "WeakFC", "Ligue 1", "date non confirmée"),
        ]
    )

    assert len(value_bets) > 0
    confidences = [vb.confidence for vb in value_bets]
    assert confidences == sorted(confidences, reverse=True)


# ============================================================
# analyze_named_fixture_detailed / analyze_named_fixtures_detailed —
# FixtureDiagnostics (5 derniers matchs par équipe + head-to-head).
# ============================================================


@pytest.mark.asyncio
async def test_analyze_named_fixture_detailed_fetches_h2h_when_both_teams_resolved(monkeypatch):
    strong_history = _history([3, 2, 3, 2, 3, 2], [0, 1, 0, 1, 0, 1], opponent="Various")
    weak_history = _history([0, 1, 0, 1, 0, 1], [3, 2, 3, 2, 3, 2], opponent="Various")

    async def fake_search_af_team(name):
        return TeamRef(id=1, name=name, logo="") if name == "StrongFC" else TeamRef(id=2, name=name, logo="")

    async def fake_get_af_team_history(team_id, _limit=15):
        return strong_history if team_id == 1 else weak_history

    h2h_calls = []

    async def fake_get_af_head_to_head(team1_id, team2_id, limit=5):
        h2h_calls.append((team1_id, team2_id, limit))
        return [
            H2HMatch(date="2023-01-01T00:00:00Z", home_team="StrongFC", away_team="WeakFC", home_goals=2, away_goals=0)
        ]

    monkeypatch.setattr(quant_analyst, "search_af_team", fake_search_af_team)
    monkeypatch.setattr(quant_analyst, "get_af_team_history", fake_get_af_team_history)
    monkeypatch.setattr(quant_analyst, "get_af_head_to_head", fake_get_af_head_to_head)

    value_bets, diagnostics = await quant_analyst.analyze_named_fixture_detailed(
        "StrongFC", "WeakFC", "Premier League", "date non confirmée"
    )

    assert value_bets  # historique suffisant, edge attendu comme dans les autres tests
    assert h2h_calls == [(1, 2, 5)]
    assert len(diagnostics.h2h_last_5) == 1
    assert len(diagnostics.home_last_5) == 5  # tronqué à 5 même si l'historique complet en a plus
    assert len(diagnostics.away_last_5) == 5
    assert diagnostics.home_team == "StrongFC"
    assert diagnostics.away_team == "WeakFC"


@pytest.mark.asyncio
async def test_analyze_named_fixture_detailed_skips_h2h_when_thesportsdb_fallback(monkeypatch):
    strong_history = _history([3, 2, 3, 2, 3, 2], [0, 1, 0, 1, 0, 1], opponent="Various")
    weak_history = _history([0, 1, 0, 1, 0, 1], [3, 2, 3, 2, 3, 2], opponent="Various")

    async def fake_search_af_team(_name):
        return None  # API-Football indisponible pour les deux équipes

    async def fake_thesportsdb_get_team_history(name, _limit=15):
        return strong_history if name == "StrongFC" else weak_history

    async def fake_get_af_head_to_head(*_args, **_kwargs):
        raise AssertionError("get_head_to_head ne devrait pas être appelé sans TeamRef API-Football des deux côtés")

    monkeypatch.setattr(quant_analyst, "search_af_team", fake_search_af_team)
    monkeypatch.setattr(quant_analyst.thesportsdb, "get_team_history", fake_thesportsdb_get_team_history)
    monkeypatch.setattr(quant_analyst, "get_af_head_to_head", fake_get_af_head_to_head)

    _value_bets, diagnostics = await quant_analyst.analyze_named_fixture_detailed(
        "StrongFC", "WeakFC", "Premier League", "date non confirmée"
    )

    assert diagnostics.h2h_last_5 == []


@pytest.mark.asyncio
async def test_analyze_named_fixtures_detailed_returns_one_diagnostics_per_fixture(monkeypatch):
    strong_history = _history([3, 2, 3, 2, 3, 2], [0, 1, 0, 1, 0, 1], opponent="Various")
    weak_history = _history([0, 1, 0, 1, 0, 1], [3, 2, 3, 2, 3, 2], opponent="Various")

    async def fake_search_af_team(_name):
        return None

    async def fake_thesportsdb_get_team_history(name, _limit=15):
        return strong_history if name == "StrongFC" else weak_history

    monkeypatch.setattr(quant_analyst, "search_af_team", fake_search_af_team)
    monkeypatch.setattr(quant_analyst.thesportsdb, "get_team_history", fake_thesportsdb_get_team_history)

    value_bets, diagnostics_list = await quant_analyst.analyze_named_fixtures_detailed(
        [
            ("StrongFC", "WeakFC", "Premier League", "date non confirmée"),
            ("StrongFC", "WeakFC", "Ligue 1", "date non confirmée"),
        ]
    )

    assert len(value_bets) > 0
    assert len(diagnostics_list) == 2
    assert all(d.home_team == "StrongFC" and d.away_team == "WeakFC" for d in diagnostics_list)
