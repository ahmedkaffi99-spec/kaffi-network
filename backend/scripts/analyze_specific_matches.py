"""Analyse une liste précise de matchs avec le moteur quantitatif — Elo,
Poisson/Dixon-Coles, Monte Carlo, Value Bet/Kelly (voir backend/README.md,
section "Moteur quantitatif").

À lancer depuis backend/, environnement virtuel activé, avec de VRAIES clés
dans .env (API_FOOTBALL_KEY, ODDS_API_KEY, ODDSPAPI_KEY, SUPABASE_*,
LOCAL_BACKEND_SECRET — ce script n'a pas besoin de Supabase mais
supabase_client.py est importé transitivement par certains modules du
pipeline, donc les variables d'environnement Supabase doivent au moins être
présentes, même factices).

Usage :
    python scripts/analyze_specific_matches.py

Chaque affiche est identifiée par NOM d'équipe (pas de découverte via le
calendrier API-Football, dont le plan gratuit ne couvre qu'une fenêtre
étroite de dates proche d'aujourd'hui — voir
tools/football_api.py::get_today_matches) : l'historique de chaque équipe
est résolu directement par nom (API-Football en priorité via
search_team/get_team_history, TheSportsDB en repli via tools/thesportsdb.py),
ce qui fonctionne pour une affiche à n'importe quelle date, même dans
plusieurs semaines.
"""
import asyncio
import sys
from pathlib import Path

# Permet de lancer ce script directement (`python scripts/analyze_specific_matches.py`)
# depuis n'importe quel dossier courant — sans ça, Python met seulement
# scripts/ sur sys.path (pas backend/), et les imports ci-dessous échouent
# avec ModuleNotFoundError: No module named 'agents'.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.quant_analyst import FixtureDiagnostics, analyze_named_fixtures_detailed  # noqa: E402

# (domicile, extérieur, compétition, date) — la compétition sert à
# interroger Understat/FBref (tools/understat.py, tools/fbref.py) pour les
# statistiques avancées quand disponibles ; la date n'est qu'un LIBELLÉ
# affiché avec le résultat (aucune recherche n'est faite par date, voir le
# docstring du module) — mets la vraie date UNIQUEMENT si tu l'as confirmée
# (ex: capture d'écran 1xBet), jamais une date devinée : afficher une fausse
# date à côté d'un vrai calcul de value bet serait trompeur.
TARGET_FIXTURES: list[tuple[str, str, str, str]] = [
    ("Newcastle United", "Liverpool", "Premier League", "date non confirmée"),
    ("Arsenal", "Coventry City", "Premier League", "date non confirmée"),
    ("Paris Saint Germain", "Stade Rennais", "Ligue 1", "date non confirmée"),
    ("Lyon", "Toulouse", "Ligue 1", "date non confirmée"),
    ("Real Madrid", "Real Sociedad", "La Liga", "date non confirmée"),
    ("Barcelona", "Athletic Bilbao", "La Liga", "date non confirmée"),
    ("Inter Milan", "Monza", "Serie A", "date non confirmée"),
    ("Frosinone Calcio", "Juventus", "Serie A", "2026-08-23"),  # confirmé (capture 1xBet)
    ("Bayern Munich", "VfB Stuttgart", "Bundesliga", "date non confirmée"),
    ("Borussia Dortmund", "Hamburger SV", "Bundesliga", "date non confirmée"),
]


def _print_team_history(team_name: str, matches) -> None:
    if not matches:
        print(f"  {team_name} : historique indisponible.")
        return
    print(f"  {team_name} — {len(matches)} dernier(s) match(s) :")
    for m in matches:
        lieu = "dom." if m.home else "ext."
        print(f"    {m.date[:10]} ({lieu}) vs {m.opponent} — {m.goals_for}-{m.goals_against} ({m.result})")


def _print_h2h(diagnostics: FixtureDiagnostics) -> None:
    if not diagnostics.h2h_last_5:
        print("  Head-to-head : indisponible (au moins une équipe non résolue via API-Football).")
        return
    print(f"  Head-to-head — {len(diagnostics.h2h_last_5)} dernière(s) confrontation(s) directe(s) :")
    for h in diagnostics.h2h_last_5:
        print(f"    {h.date[:10]} : {h.home_team} {h.home_goals}-{h.away_goals} {h.away_team}")


async def main() -> None:
    print(f"Analyse de {len(TARGET_FIXTURES)} affiches (résolution par nom, indépendante du calendrier API-Football)...\n")

    value_bets, diagnostics_list = await analyze_named_fixtures_detailed(TARGET_FIXTURES)

    print("=" * 70)
    print("DONNÉES BRUTES — 20 équipes une par une (5 derniers matchs + H2H)")
    print("=" * 70)
    for diagnostics in diagnostics_list:
        print(f"\n{diagnostics.home_team} vs {diagnostics.away_team}")
        _print_team_history(diagnostics.home_team, diagnostics.home_last_5)
        _print_team_history(diagnostics.away_team, diagnostics.away_last_5)
        _print_h2h(diagnostics)
    print()

    if not value_bets:
        print("Aucun value bet détecté — soit edge insuffisant partout, soit historique/cotes indisponibles pour ces équipes.")
        return

    print("=" * 70)
    print("VALUE BETS")
    print("=" * 70)
    for vb in value_bets:
        stars = "★" * vb.star_count
        print(f"{stars} {vb.star_label} — {vb.home_team} vs {vb.away_team} ({vb.competition})")
        print(f"  {vb.selection} @ {vb.bookmaker_odds} — modèle {vb.model_prob * 100:.1f}% vs marché {vb.implied_prob * 100:.1f}% (edge {vb.edge * 100:+.1f}%)")
        print(f"  EV {vb.ev:+.3f} par unité — mise Kelly suggérée : {vb.kelly_stake_fraction * 100:.1f}% de la bankroll — confiance {vb.confidence}/100")
        if vb.elo_rating_gap is not None:
            print(f"  Écart Elo (domicile - extérieur, avantage terrain inclus) : {vb.elo_rating_gap:+.0f}")
        print()


if __name__ == "__main__":
    asyncio.run(main())
