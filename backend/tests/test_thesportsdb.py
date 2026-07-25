"""Tests de tools/thesportsdb.py — même principe de faux client httpx que
tests/test_oddspapi.py et tests/test_football_api.py."""
import pytest

import tools.thesportsdb as thesportsdb

FAKE_SEARCH_RESPONSE = {
    "teams": [
        {"idTeam": "133714", "strTeam": "Arsenal"},
        {"idTeam": "133615", "strTeam": "Arsenal B"},
    ]
}

FAKE_EVENTS_RESPONSE = {
    "results": [
        {"idHomeTeam": "133714", "idAwayTeam": "133602", "strHomeTeam": "Arsenal", "strAwayTeam": "Chelsea", "intHomeScore": "2", "intAwayScore": "0", "dateEvent": "2024-05-01"},
        {"idHomeTeam": "133613", "idAwayTeam": "133714", "strHomeTeam": "Everton", "strAwayTeam": "Arsenal", "intHomeScore": "1", "intAwayScore": "1", "dateEvent": "2024-04-24"},
        {"idHomeTeam": "133714", "idAwayTeam": "133604", "strHomeTeam": "Arsenal", "strAwayTeam": "Liverpool", "intHomeScore": "0", "intAwayScore": "2", "dateEvent": "2024-04-17"},
        # Score manquant (match pas encore joué ou non renseigné) — doit être ignoré.
        {"idHomeTeam": "133714", "idAwayTeam": "133605", "strHomeTeam": "Arsenal", "strAwayTeam": "Fulham", "intHomeScore": None, "intAwayScore": None, "dateEvent": "2024-05-08"},
    ]
}


class _FakeResponse:
    def __init__(self, json_data, is_success=True):
        self._json_data = json_data
        self.is_success = is_success

    def json(self):
        return self._json_data


class _FakeAsyncClient:
    def __init__(self, responses_by_suffix):
        self._responses = responses_by_suffix

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, params=None, timeout=None):
        for suffix, response in self._responses.items():
            if url.endswith(suffix):
                return response
        raise AssertionError(f"URL inattendue dans le test : {url}")


@pytest.mark.asyncio
async def test_get_team_history_maps_home_and_away_correctly(monkeypatch):
    fake_client = _FakeAsyncClient(
        {"/searchteams.php": _FakeResponse(FAKE_SEARCH_RESPONSE), "/eventslast.php": _FakeResponse(FAKE_EVENTS_RESPONSE)}
    )
    monkeypatch.setattr(thesportsdb.httpx, "AsyncClient", lambda: fake_client)

    history = await thesportsdb.get_team_history("Arsenal FC", limit=15)

    assert history is not None
    assert len(history) == 3  # le match au score manquant est exclu

    home_match = next(m for m in history if m.opponent == "Chelsea")
    assert home_match.home is True
    assert home_match.goals_for == 2
    assert home_match.result == "W"

    away_match = next(m for m in history if m.opponent == "Everton")
    assert away_match.home is False
    assert away_match.goals_for == 1  # but d'Arsenal (away) dans ce match
    assert away_match.result == "D"


@pytest.mark.asyncio
async def test_get_team_history_respects_limit(monkeypatch):
    fake_client = _FakeAsyncClient(
        {"/searchteams.php": _FakeResponse(FAKE_SEARCH_RESPONSE), "/eventslast.php": _FakeResponse(FAKE_EVENTS_RESPONSE)}
    )
    monkeypatch.setattr(thesportsdb.httpx, "AsyncClient", lambda: fake_client)

    history = await thesportsdb.get_team_history("Arsenal FC", limit=2)
    assert len(history) == 2


@pytest.mark.asyncio
async def test_get_team_history_below_min_matches_returns_none(monkeypatch):
    sparse_response = {"results": FAKE_EVENTS_RESPONSE["results"][:1]}  # seulement 1 match valable
    fake_client = _FakeAsyncClient(
        {"/searchteams.php": _FakeResponse(FAKE_SEARCH_RESPONSE), "/eventslast.php": _FakeResponse(sparse_response)}
    )
    monkeypatch.setattr(thesportsdb.httpx, "AsyncClient", lambda: fake_client)

    assert await thesportsdb.get_team_history("Arsenal FC") is None


@pytest.mark.asyncio
async def test_get_team_history_team_not_found_returns_none(monkeypatch):
    fake_client = _FakeAsyncClient({"/searchteams.php": _FakeResponse({"teams": []})})
    monkeypatch.setattr(thesportsdb.httpx, "AsyncClient", lambda: fake_client)

    assert await thesportsdb.get_team_history("Totally Unknown FC") is None
