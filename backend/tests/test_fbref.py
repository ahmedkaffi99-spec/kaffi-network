from bs4 import BeautifulSoup

from tools.fbref import FbrefTeamStats, _parse_squad_table, _uncomment_tables, fbref_competition_path, find_team_stats

FAKE_HTML = """
<div id="all_stats_squads_passing_for">
<!--
<table id="stats_squads_passing_for">
<tbody>
<tr><th data-stat="team"><a href="/x">Liverpool</a></th><td data-stat="games">10</td><td data-stat="progressive_passes">450</td></tr>
<tr><th data-stat="team"><a href="/y">Arsenal</a></th><td data-stat="games">10</td><td data-stat="progressive_passes">380</td></tr>
</tbody>
</table>
-->
</div>
<div id="all_stats_squads_possession_for">
<!--
<table id="stats_squads_possession_for">
<tbody>
<tr><th data-stat="team"><a href="/x">Liverpool</a></th><td data-stat="progressive_carries">210</td></tr>
<tr><th data-stat="team"><a href="/y">Arsenal</a></th><td data-stat="progressive_carries">190</td></tr>
</tbody>
</table>
-->
</div>
"""


def test_fbref_competition_path_known_competition():
    assert fbref_competition_path("Premier League") == "9/Premier-League-Stats"


def test_fbref_competition_path_unknown_competition():
    assert fbref_competition_path("Champions League") is None


def test_uncomment_tables_and_parse_data_stat_cells():
    full_html = _uncomment_tables(FAKE_HTML)
    soup = BeautifulSoup(full_html, "lxml")

    passing = _parse_squad_table(soup, "stats_squads_passing_for", ["games", "progressive_passes"])
    possession = _parse_squad_table(soup, "stats_squads_possession_for", ["progressive_carries"])

    assert passing["Liverpool"]["progressive_passes"] == 450.0
    assert possession["Arsenal"]["progressive_carries"] == 190.0


def test_parse_squad_table_missing_table_returns_empty():
    soup = BeautifulSoup("<html></html>", "lxml")
    assert _parse_squad_table(soup, "does_not_exist", ["games"]) == {}


def test_find_team_stats_fuzzy_matches_team_name():
    stats = FbrefTeamStats(team="Liverpool", matches_played=10, progressive_passes=450)
    league_stats = {"Liverpool": stats}

    assert find_team_stats("Liverpool FC", league_stats) is stats
    assert find_team_stats("Chelsea", league_stats) is None
