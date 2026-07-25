"""Tests de tools/oddspapi.py — logique pure (find_fixture,
find_selection_price) sans mock, puis les fonctions réseau avec un faux
client httpx (même principe que tests/fake_supabase.py : on mocke la
frontière, on exerce le vrai code de parsing autour)."""
import pytest

import tools.oddspapi as oddspapi


FAKE_FIXTURES = [
    {"fixtureId": "id1", "participant1Name": "Real Madrid", "participant2Name": "Sevilla", "hasOdds": True},
    {"fixtureId": "id2", "participant1Name": "Chelsea", "participant2Name": "Arsenal", "hasOdds": True},
]

FAKE_MARKETS_RESPONSE = [
    {
        "marketId": 101,
        "marketName": "Full Time Result",
        "marketType": "1x2",
        "sportId": 10,
        "outcomes": [
            {"outcomeId": 1, "outcomeName": "1"},
            {"outcomeId": 2, "outcomeName": "X"},
            {"outcomeId": 3, "outcomeName": "2"},
        ],
    },
    {
        "marketId": 1016,
        "marketName": "Over Under Full Time",
        "marketType": "totals",
        "handicap": 2.5,
        "sportId": 10,
        "outcomes": [
            {"outcomeId": 10, "outcomeName": "Over"},
            {"outcomeId": 11, "outcomeName": "Under"},
        ],
    },
    {
        "marketId": 104,
        "marketName": "Both Teams To Score",
        "marketType": "btts",
        "sportId": 10,
        "outcomes": [
            {"outcomeId": 20, "outcomeName": "Yes"},
            {"outcomeId": 21, "outcomeName": "No"},
        ],
    },
    # Un marché d'un autre sport (basketball) — doit être filtré par sportId.
    {"marketId": 999, "marketName": "Point Spread", "marketType": "spread", "sportId": 5, "outcomes": []},
]

FAKE_ODDS_RESPONSE = [
    {
        "fixtureId": "id1",
        "bookmakerOdds": {
            "1xbet": {
                "markets": {
                    "101": {"outcomes": {"1": {"players": {"0": {"price": 1.65}}}, "2": {"players": {"0": {"price": 4.2}}}, "3": {"players": {"0": {"price": 5.5}}}}},
                    "1016": {"outcomes": {"10": {"players": {"0": {"price": 1.9}}}, "11": {"players": {"0": {"price": 1.85}}}}},
                    "104": {"outcomes": {"20": {"players": {"0": {"price": 1.7}}}, "21": {"players": {"0": {"price": 2.05}}}}},
                }
            }
        },
    }
]


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


@pytest.fixture(autouse=True)
def _reset_caches_and_env(monkeypatch):
    monkeypatch.setattr(oddspapi, "_market_names_cache", {})
    monkeypatch.setattr(oddspapi, "_fixtures_cache", None)
    monkeypatch.setenv("ODDSPAPI_KEY", "test-key")


def test_find_fixture_matches_by_team_name():
    fixture = oddspapi.find_fixture("Real Madrid", "Sevilla", FAKE_FIXTURES)
    assert fixture is not None
    assert fixture["fixtureId"] == "id1"


def test_find_fixture_no_match_returns_none():
    assert oddspapi.find_fixture("Bayern Munich", "PSG", FAKE_FIXTURES) is None


def test_find_selection_price_by_market_type():
    markets = [
        oddspapi.OddsPapiMarket(
            market_id="101", name="Full Time Result", market_type="1x2", handicap=None, period=None,
            selections=[oddspapi.OddsPapiSelection("1", 1.65), oddspapi.OddsPapiSelection("X", 4.2), oddspapi.OddsPapiSelection("2", 5.5)],
        )
    ]
    price = oddspapi.find_selection_price(markets, market_type="1x2", selection="1")
    assert price == 1.65


def test_find_selection_price_by_market_name_and_handicap():
    markets = [
        oddspapi.OddsPapiMarket(
            market_id="1016", name="Over Under Full Time", market_type="totals", handicap=2.5, period="fulltime",
            selections=[oddspapi.OddsPapiSelection("Over", 1.9), oddspapi.OddsPapiSelection("Under", 1.85)],
        )
    ]
    assert oddspapi.find_selection_price(markets, market_name="Over Under Full Time", handicap=2.5, selection="Under") == 1.85
    # Mauvaise ligne de handicap -> aucune correspondance
    assert oddspapi.find_selection_price(markets, market_name="Over Under Full Time", handicap=3.5, selection="Under") is None


@pytest.mark.asyncio
async def test_get_market_names_filters_by_sport_and_caches(monkeypatch):
    fake_client = _FakeAsyncClient({"/markets": _FakeResponse(FAKE_MARKETS_RESPONSE)})
    monkeypatch.setattr(oddspapi.httpx, "AsyncClient", lambda: fake_client)

    names = await oddspapi.get_market_names()
    assert "101" in names
    assert names["101"]["type"] == "1x2"
    assert "999" not in names  # sportId=5, filtré


@pytest.mark.asyncio
async def test_get_markets_for_fixture_parses_prices(monkeypatch):
    fake_client = _FakeAsyncClient(
        {
            "/markets": _FakeResponse(FAKE_MARKETS_RESPONSE),
            "/odds": _FakeResponse(FAKE_ODDS_RESPONSE),
        }
    )
    monkeypatch.setattr(oddspapi.httpx, "AsyncClient", lambda: fake_client)

    markets = await oddspapi.get_markets_for_fixture("id1")
    assert len(markets) == 3

    price_1x2_home = oddspapi.find_selection_price(markets, market_type="1x2", selection="1")
    assert price_1x2_home == 1.65

    price_btts_yes = oddspapi.find_selection_price(markets, market_name="Both Teams To Score", selection="Yes")
    assert price_btts_yes == 1.7


@pytest.mark.asyncio
async def test_get_bookmaker_price_end_to_end(monkeypatch):
    fake_client = _FakeAsyncClient(
        {
            "/fixtures": _FakeResponse(FAKE_FIXTURES),
            "/markets": _FakeResponse(FAKE_MARKETS_RESPONSE),
            "/odds": _FakeResponse(FAKE_ODDS_RESPONSE),
        }
    )
    monkeypatch.setattr(oddspapi.httpx, "AsyncClient", lambda: fake_client)

    price = await oddspapi.get_bookmaker_price("Real Madrid", "Sevilla", market_type="1x2", selection="1")
    assert price == 1.65


@pytest.mark.asyncio
async def test_get_bookmaker_price_unknown_fixture_returns_none(monkeypatch):
    fake_client = _FakeAsyncClient({"/fixtures": _FakeResponse(FAKE_FIXTURES)})
    monkeypatch.setattr(oddspapi.httpx, "AsyncClient", lambda: fake_client)

    price = await oddspapi.get_bookmaker_price("Nonexistent FC", "Nowhere United", market_type="1x2", selection="1")
    assert price is None
