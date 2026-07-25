"""Analyse une liste précise de matchs (au lieu de tout le calendrier du
jour) avec le moteur quantitatif — Elo, Poisson/Dixon-Coles, Monte Carlo,
Value Bet/Kelly (voir backend/README.md, section "Moteur quantitatif").

À lancer depuis backend/, environnement virtuel activé, avec de VRAIES clés
dans .env (API_FOOTBALL_KEY, ODDS_API_KEY, SUPABASE_*, LOCAL_BACKEND_SECRET
— ce script n'a pas besoin de Supabase mais supabase_client.py est importé
transitivement par certains modules du pipeline, donc les variables
d'environnement Supabase doivent au moins être présentes, même factices).

Usage :
    python scripts/analyze_specific_matches.py

Chaque affiche a SA PROPRE date dans TARGET_FIXTURES ci-dessous — les 5
grands championnats n'ouvrent pas tous le même week-end, l'API-Football
interroge le calendrier par date, pas par nom d'équipe. Remplis/corrige les
dates manquantes (None) avant de lancer. Si un match n'est pas trouvé,
vérifie la date et que le nom de l'équipe est reconnaissable (l'appariement
tolère les variantes courantes via tools/odds_api.py::team_similarity, mais
pas une faute totale).
"""
import asyncio

from agents.quant_analyst import analyze_fixtures
from tools.football_api import get_today_matches
from tools.odds_api import team_similarity

# (domicile, extérieur, date YYYY-MM-DD) — une seule confirmée pour l'instant
# (Frosinone Calcio vs Juventus, Serie A, 23.08.2026 19h30, vu sur ta
# capture d'écran 1xBet). Complète les autres avec les vraies dates avant
# de lancer — laissées à None en attendant.
TARGET_FIXTURES: list[tuple[str, str, str | None]] = [
    ("Newcastle United", "Liverpool", None),
    ("Arsenal", "Coventry City", None),
    ("Paris Saint Germain", "Stade Rennais", None),
    ("Lyon", "Toulouse", None),
    ("Real Madrid", "Real Sociedad", None),
    ("Barcelona", "Athletic Bilbao", None),
    ("Inter Milan", "Monza", None),
    ("Frosinone Calcio", "Juventus", "2026-08-23"),  # confirmé (capture 1xBet)
    ("Bayern Munich", "VfB Stuttgart", None),
    ("Borussia Dortmund", "Hamburger SV", None),
]


async def main() -> None:
    with_date = [f for f in TARGET_FIXTURES if f[2]]
    without_date = [f for f in TARGET_FIXTURES if not f[2]]

    if without_date:
        print("Dates manquantes (ignorées cette fois — complète TARGET_FIXTURES puis relance) :")
        for home, away, _ in without_date:
            print(f"  - {home} vs {away}")
        print()

    if not with_date:
        print("Aucune affiche n'a de date renseignée — rien à analyser.")
        return

    # Un seul appel API-Football par date distincte (pas un appel par match).
    dates_needed = sorted({date for _, _, date in with_date})
    matches_by_date = {date: await get_today_matches(date) for date in dates_needed}

    matched = []
    for home, away, date in with_date:
        candidates = matches_by_date.get(date, [])
        found = next(
            (m for m in candidates if team_similarity(m.home_team.name, home) >= 0.3 and team_similarity(m.away_team.name, away) >= 0.3),
            None,
        )
        if found:
            matched.append(found)
        else:
            print(f"Introuvable dans le calendrier du {date} : {home} vs {away}")

    if not matched:
        print("Aucune des affiches demandées n'a été trouvée — vérifie les dates.")
        return

    print(f"\n{len(matched)}/{len(with_date)} affiches trouvées — analyse en cours (peut prendre plusieurs minutes, rate limit API-Football 7s/appel)...\n")

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
    asyncio.run(main())
