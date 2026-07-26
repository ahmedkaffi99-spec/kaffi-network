"""Tests de tools/football_api.py::search_team et get_team_history — mêmes
principes que tests/test_oddspapi.py : un faux client httpx, la quota
Supabase et le rate-limit réel sont neutralisés pour ne tester que la
logique de parsing/correspondance."""
import pytest

import tools.football_api as football_api

FAKE_TEAMS_SEARCH_RESPONSE = {
    "response": [
        {"team": {"id": 541, "name": "Real Madrid", "logo": "https://example.com/541.png"}},
        {"team": {"id": 542, "name": "Real Madrid Castilla", "logo": "https://example.com/542.png"}},
    ]
}

FAKE_FIXTURES_BY_TEAM_RESPONSE = {
    "response": [
        {
            "fixture": {"id": 1, "date": "2024-05-01T20:00:00+00:00", "status": {"short": "FT"}},
            "league": {"name": "La Liga"},
            "teams": {"home": {"id": 541, "name": "Real Madrid"}, "away": {"id": 999, "name": "Sevilla"}},
            "goals": {"home": 3, "away": 1},
        },
        {
            "fixture": {"id": 2, "date": "2024-04-20T20:00:00+00:00", "status": {"short": "FT"}},
            "league": {"name": "La Liga"},
            "teams": {"home": {"id": 998, "name": "Barcelona"}, "away": {"id": 541, "name": "Real Madrid"}},
            "goals": {"home": 2, "away": 2},
        },
        {
            # Match pas encore joué — doit être filtré (hors FINISHED_STATUSES).
            "fixture": {"id": 3, "date": "2024-06-01T20:00:00+00:00", "status": {"short": "NS"}},
            "league": {"name": "La Liga"},
            "teams": {"home": {"id": 541, "name": "Real Madrid"}, "away": {"id": 997, "name": "Betis"}},
            "goals": {"home": None, "away": None},
        },
    ]
}


class _FakeResponse:
    def __init__(self, json_data, is_success=True):
        self._json_data = json_data
        self.is_success = is_success
        self.status_code = 200 if is_success else 500
        self.text = ""

    def json(self):
        return self._json_data


class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, headers=None, timeout=None):
        return self._response


@pytest.fixture(autouse=True)
def _patch_boundaries(monkeypatch):
    monkeypatch.setenv("API_FOOTBALL_KEY", "test-key")
    monkeypatch.setattr(football_api, "increment_quota", lambda *_a, **_k: None)

    async def instant_sleep(_seconds):
        return None

    monkeypatch.setattr(football_api.asyncio, "sleep", instant_sleep)


@pytest.mark.asyncio
async def test_search_team_picks_best_fuzzy_match(monkeypatch):
    monkeypatch.setattr(football_api.httpx, "AsyncClient", lambda: _FakeAsyncClient(_FakeResponse(FAKE_TEAMS_SEARCH_RESPONSE)))

    team = await football_api.search_team("Real Madrid")
    assert team is not None
    assert team.id == 541
    assert team.name == "Real Madrid"


@pytest.mark.asyncio
async def test_search_team_no_results_returns_none(monkeypatch):
    monkeypatch.setattr(football_api.httpx, "AsyncClient", lambda: _FakeAsyncClient(_FakeResponse({"response": []})))

    assert await football_api.search_team("Nonexistent FC") is None


@pytest.mark.asyncio
async def test_get_team_history_filters_finished_matches_and_maps_home_away(monkeypatch):
    monkeypatch.setattr(football_api.httpx, "AsyncClient", lambda: _FakeAsyncClient(_FakeResponse(FAKE_FIXTURES_BY_TEAM_RESPONSE)))

    history = await football_api.get_team_history(541, limit=15)

    assert len(history) == 2  # le match "NS" (pas encore joué) est exclu

    home_match = next(m for m in history if m.opponent == "Sevilla")
    assert home_match.home is True
    assert home_match.goals_for == 3
    assert home_match.goals_against == 1
    assert home_match.result == "W"

    away_match = next(m for m in history if m.opponent == "Barcelona")
    assert away_match.home is False
    assert away_match.goals_for == 2  # buts de Real Madrid (away) dans ce match
    assert away_match.goals_against == 2
    assert away_match.result == "D"


@pytest.mark.asyncio
async def test_get_team_history_respects_limit(monkeypatch):
    monkeypatch.setattr(football_api.httpx, "AsyncClient", lambda: _FakeAsyncClient(_FakeResponse(FAKE_FIXTURES_BY_TEAM_RESPONSE)))

    history = await football_api.get_team_history(541, limit=1)
    assert len(history) == 1


FAKE_HEAD_TO_HEAD_RESPONSE = {
    "response": [
        {
            "fixture": {"id": 10, "date": "2023-10-01T20:00:00+00:00", "status": {"short": "FT"}},
            "teams": {"home": {"id": 541, "name": "Real Madrid"}, "away": {"id": 998, "name": "Barcelona"}},
            "goals": {"home": 2, "away": 1},
        },
        {
            "fixture": {"id": 11, "date": "2024-04-20T20:00:00+00:00", "status": {"short": "FT"}},
            "teams": {"home": {"id": 998, "name": "Barcelona"}, "away": {"id": 541, "name": "Real Madrid"}},
            "goals": {"home": 2, "away": 2},
        },
        {
            # Pas encore joué — doit être filtré (hors FINISHED_STATUSES).
            "fixture": {"id": 12, "date": "2026-08-23T20:00:00+00:00", "status": {"short": "NS"}},
            "teams": {"home": {"id": 541, "name": "Real Madrid"}, "away": {"id": 998, "name": "Barcelona"}},
            "goals": {"home": None, "away": None},
        },
    ]
}


@pytest.mark.asyncio
async def test_get_head_to_head_filters_unfinished_and_sorts_most_recent_first(monkeypatch):
    monkeypatch.setattr(football_api.httpx, "AsyncClient", lambda: _FakeAsyncClient(_FakeResponse(FAKE_HEAD_TO_HEAD_RESPONSE)))

    h2h = await football_api.get_head_to_head(541, 998, limit=5)

    assert len(h2h) == 2  # le match "NS" est exclu
    assert h2h[0].date == "2024-04-20T20:00:00+00:00"  # le plus récent en premier
    assert h2h[0].home_team == "Barcelona"
    assert h2h[0].away_goals == 2
    assert h2h[1].date == "2023-10-01T20:00:00+00:00"


@pytest.mark.asyncio
async def test_get_head_to_head_respects_limit(monkeypatch):
    monkeypatch.setattr(football_api.httpx, "AsyncClient", lambda: _FakeAsyncClient(_FakeResponse(FAKE_HEAD_TO_HEAD_RESPONSE)))

    h2h = await football_api.get_head_to_head(541, 998, limit=1)
    assert len(h2h) == 1


FAKE_H2H_PLAN_ERROR_RESPONSE = {"errors": {"plan": "Free plans do not have access to the Last parameter."}, "response": []}


class _FakeAsyncClientSequence:
    """Renvoie une réponse différente à chaque appel `.get` successif — pour
    tester le repli sur `last=FREE_PLAN_MAX_H2H_LAST` après un premier échec
    lié à la restriction du plan gratuit sur /fixtures/headtohead."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.call_count = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, headers=None, timeout=None):
        response = self._responses[self.call_count]
        self.call_count += 1
        return response


@pytest.mark.asyncio
async def test_get_head_to_head_retries_with_free_plan_max_last_on_plan_error(monkeypatch):
    fake_client = _FakeAsyncClientSequence(
        [_FakeResponse(FAKE_H2H_PLAN_ERROR_RESPONSE), _FakeResponse(FAKE_HEAD_TO_HEAD_RESPONSE)]
    )
    monkeypatch.setattr(football_api.httpx, "AsyncClient", lambda: fake_client)

    h2h = await football_api.get_head_to_head(541, 998, limit=5)

    assert fake_client.call_count == 2  # 1er essai (last=5) échoué, repli sur last=2 réussi
    assert len(h2h) == 2


@pytest.mark.asyncio
async def test_get_head_to_head_does_not_retry_when_limit_already_at_free_plan_max(monkeypatch):
    fake_client = _FakeAsyncClientSequence([_FakeResponse(FAKE_H2H_PLAN_ERROR_RESPONSE)])
    monkeypatch.setattr(football_api.httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(RuntimeError):
        await football_api.get_head_to_head(541, 998, limit=2)
    assert fake_client.call_count == 1  # pas de boucle infinie de repli


@pytest.mark.asyncio
async def test_get_head_to_head_reraises_unrelated_errors(monkeypatch):
    unrelated_error = {"errors": {"quota": "Too many requests"}, "response": []}
    fake_client = _FakeAsyncClientSequence([_FakeResponse(unrelated_error)])
    monkeypatch.setattr(football_api.httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(RuntimeError):
        await football_api.get_head_to_head(541, 998, limit=5)
    assert fake_client.call_count == 1  # pas de repli pour une erreur qui n'est pas liée au paramètre `last`
