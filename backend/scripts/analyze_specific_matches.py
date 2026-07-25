"""Analyse une liste précise de matchs (au lieu de tout le calendrier du
jour) avec le moteur quantitatif — Elo, Poisson/Dixon-Coles, Monte Carlo,
Value Bet/Kelly (voir backend/README.md, section "Moteur quantitatif").

À lancer depuis backend/, environnement virtuel activé, avec de VRAIES clés
dans .env (API_FOOTBALL_KEY, ODDS_API_KEY, SUPABASE_*, LOCAL_BACKEND_SECRET
— ce script n'a pas besoin de Supabase mais supabase_client.py est importé
transitivement par certains modules du pipeline, donc les variables
d'environnement Supabase doivent au moins être présentes, même factices).

Usage :
    python scripts/analyze_specific_matches.py 2026-08-16

Remplace la date par le vrai jour où ces matchs sont programmés — l'API-
Football interroge le calendrier PAR DATE, pas par nom d'équipe. Si un match
n'est pas trouvé, vérifie que la date est la bonne et que le nom de
l'équipe est reconnaissable (l'appariement tolère les variantes courantes
via tools/odds_api.py::team_similarity, mais pas une faute totale).
"""
import asyncio
import sys

from agents.quant_analyst import analyze_fixtures
from tools.football_api import get_today_matches
from tools.odds_api import team_similarity

# NOTE : "Juventus vs calcio" dans la demande d'origine — "calcio" veut dire
# "football" en italien, ce n'est pas un nom de club. Remplacé ici par
# Cagliari à titre d'exemple — CORRIGE cette ligne avec le vrai adversaire
# avant de lancer le script.
TARGET_FIXTURES = [
    ("Newcastle United", "Liverpool"),
    ("Arsenal", "Coventry City"),
    ("Paris Saint Germain", "Stade Rennais"),
    ("Lyon", "Toulouse"),
    ("Real Madrid", "Real Sociedad"),
    ("Barcelona", "Athletic Bilbao"),
    ("Inter Milan", "Monza"),
    ("Juventus", "Cagliari"),  # <- à corriger, "calcio" n'est pas un club
    ("Bayern Munich", "VfB Stuttgart"),
    ("Borussia Dortmund", "Hamburger SV"),
]


async def main(date: str) -> None:
    all_matches = await get_today_matches(date)
    if not all_matches:
        print(f"Aucun match trouvé pour {date} sur API-Football (mauvaise date, ou aucun match ce jour-là).")
        return

    matched = []
    for home, away in TARGET_FIXTURES:
        found = next(
            (
                m
                for m in all_matches
                if team_similarity(m.home_team.name, home) >= 0.3 and team_similarity(m.away_team.name, away) >= 0.3
            ),
            None,
        )
        if found:
            matched.append(found)
        else:
            print(f"Introuvable dans le calendrier du {date} : {home} vs {away}")

    if not matched:
        print("Aucune des affiches demandées n'a été trouvée à cette date — vérifie la date.")
        return

    print(f"\n{len(matched)}/{len(TARGET_FIXTURES)} affiches trouvées — analyse en cours (peut prendre plusieurs minutes, rate limit API-Football 7s/appel)...\n")

    value_bets = await analyze_fixtures(matched)

    if not value_bets:
        print("Aucun value bet détecté (edge insuffisant, ou historique/cotes indisponibles) sur ces affiches.")
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
    if len(sys.argv) != 2:
        print("Usage : python scripts/analyze_specific_matches.py YYYY-MM-DD")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
