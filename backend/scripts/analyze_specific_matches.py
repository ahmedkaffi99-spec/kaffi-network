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

from agents.quant_analyst import analyze_named_fixtures  # noqa: E402

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


async def main() -> None:
    print(f"Analyse de {len(TARGET_FIXTURES)} affiches (résolution par nom, indépendante du calendrier API-Football)...\n")

    value_bets = await analyze_named_fixtures(TARGET_FIXTURES)

    if not value_bets:
        print("Aucun value bet détecté — soit edge insuffisant partout, soit historique/cotes indisponibles pour ces équipes.")
        return

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
