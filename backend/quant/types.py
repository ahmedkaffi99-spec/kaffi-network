"""Types partagés du moteur quantitatif (Elo, Poisson/Dixon-Coles, Monte Carlo,
value bets) — voir backend/README.md, section "Moteur quantitatif"."""
from dataclasses import dataclass


@dataclass
class HistoricalMatch:
    """Un match terminé, utilisé pour calibrer Elo et Poisson/Dixon-Coles.
    home_xg/away_xg optionnels — quand disponibles (Understat), ils sont
    mélangés aux buts réels pour réduire le bruit d'échantillon (voir
    quant/poisson_model.py:blended_goals)."""

    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    date: str  # ISO 8601 — utilisé pour l'ordre chronologique et la pondération temporelle
    home_xg: float | None = None
    away_xg: float | None = None
