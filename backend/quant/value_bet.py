"""Détection de value bets — Edge, Expected Value, Kelly Criterion, score de
confiance sur 100 et classement par étoiles.

Module de calcul pur (aucun appel réseau/Supabase ici) — la collecte des
probabilités modèle (Monte Carlo) et des cotes bookmaker (tools/odds_api.py)
est de la responsabilité de l'appelant (agents/quant_analyst.py). Ça permet
de tester chaque formule isolément avec des valeurs connues.
"""
from dataclasses import dataclass

# Edge (écart probabilité modèle - probabilité implicite bookmaker) au-delà
# duquel le score de confiance plafonne à son maximum pour cette composante
# — un edge de +15% ou plus est déjà exceptionnel, au-delà ça ne veut
# généralement dire qu'une erreur de modèle plutôt qu'une vraie opportunité.
EDGE_FOR_FULL_CONFIDENCE = 0.15
# Nombre de matchs historiques utilisés pour la calibration au-delà duquel
# la composante "taille d'échantillon" du score de confiance plafonne.
SAMPLE_SIZE_FOR_FULL_CONFIDENCE = 15
# Écart entre bookmakers (voir tools/odds_api.py::MAX_BOOKMAKER_SPREAD) —
# au-delà, le marché est jugé trop incertain pour contribuer positivement à
# la confiance.
MAX_BOOKMAKER_SPREAD_PCT = 20.0
# Fraction de Kelly recommandée (Kelly "fractionnaire") — miser du Kelly
# plein sur une estimation de probabilité forcément bruitée est un moyen
# connu de ruiner une bankroll ; l'usage professionnel standard est de
# miser une fraction (souvent 1/4 à 1/2) du Kelly théorique.
DEFAULT_KELLY_MULTIPLIER = 0.25
# Plafond dur sur la mise suggérée, quel que soit le Kelly calculé — jamais
# suggérer de miser plus d'un quart de la bankroll sur un seul pari.
MAX_KELLY_FRACTION = 0.25

STAR_TIERS = [
    (90, "Exceptionnel", 5),
    (75, "Très bon", 4),
    (60, "Bon", 3),
    (45, "Moyen", 2),
    (0, "Faible", 1),
]


def implied_probability(decimal_odds: float) -> float:
    if decimal_odds <= 0:
        return 0.0
    return 1.0 / decimal_odds


def edge(model_prob: float, implied_prob: float) -> float:
    """Écart entre la probabilité estimée par le modèle et celle impliquée
    par la cote bookmaker — positif signifie que le modèle juge l'issue
    plus probable que le marché ne le paie (value bet potentiel)."""
    return model_prob - implied_prob


def expected_value(model_prob: float, decimal_odds: float) -> float:
    """EV par unité misée : E[retour] - mise, soit model_prob*cote - 1.
    Positif = pari à valeur espérée positive sur le long terme (si le
    modèle est bien calibré)."""
    return model_prob * decimal_odds - 1.0


def kelly_fraction(
    model_prob: float,
    decimal_odds: float,
    kelly_multiplier: float = DEFAULT_KELLY_MULTIPLIER,
    max_fraction: float = MAX_KELLY_FRACTION,
) -> float:
    """Fraction de bankroll à miser (Kelly Criterion, cotes décimales) :
    f* = (p*cote - 1) / (cote - 1). Multipliée par `kelly_multiplier`
    (Kelly fractionnaire — réduit le risque de ruine face à une probabilité
    modèle imparfaite) et plafonnée à `max_fraction`. Jamais négative — un
    edge négatif signifie "ne pas parier", pas "parier contre"."""
    if decimal_odds <= 1:
        return 0.0
    raw = (model_prob * decimal_odds - 1.0) / (decimal_odds - 1.0)
    if raw <= 0:
        return 0.0
    return round(min(raw * kelly_multiplier, max_fraction), 4)


def confidence_score(
    edge_value: float,
    sample_size: int = 0,
    bookmaker_spread_pct: float | None = None,
    odds_only_mode: bool = False,
) -> float:
    """Score 0-100 combinant trois signaux, documentés et plafonnés
    indépendamment (jamais un simple ratio non borné) :

    - Ampleur de l'edge (jusqu'à 70 points) — le signal principal.
    - Taille de l'échantillon historique utilisé pour calibrer le modèle
      (jusqu'à 20 points) — un edge calculé sur 2 matchs vaut moins qu'un
      edge calculé sur 15+.
    - Accord entre bookmakers sur la cote (jusqu'à 10 points) — un marché
      où les bookmakers sont d'accord est un prix de référence plus fiable
      à comparer ; sans cette donnée, crédit neutre (5/10).

    Le mode "cotes uniquement" (API-Football indisponible, voir
    agents/analyst.py::odds_only_mode) réduit le score final de 20% — le
    modèle dispose alors de moins de données pour calibrer sa probabilité."""
    edge_component = min(abs(edge_value) / EDGE_FOR_FULL_CONFIDENCE, 1.0) * 70

    sample_component = min(sample_size / SAMPLE_SIZE_FOR_FULL_CONFIDENCE, 1.0) * 20 if sample_size > 0 else 0.0

    if bookmaker_spread_pct is None:
        spread_component = 5.0
    else:
        spread_component = max(0.0, 1 - min(bookmaker_spread_pct / MAX_BOOKMAKER_SPREAD_PCT, 1.0)) * 10

    score = edge_component + sample_component + spread_component
    if odds_only_mode:
        score *= 0.8

    return round(min(max(score, 0.0), 100.0), 1)


def star_rating(score: float) -> tuple[str, int]:
    """(libellé, nombre d'étoiles) — voir STAR_TIERS pour les seuils exacts."""
    for threshold, label, stars in STAR_TIERS:
        if score >= threshold:
            return label, stars
    return STAR_TIERS[-1][1], STAR_TIERS[-1][2]


@dataclass
class ValueBet:
    home_team: str
    away_team: str
    competition: str
    match_datetime: str
    market: str  # "1X2" | "BTTS" | "Over/Under"
    selection: str  # ex: "Victoire domicile", "Plus de 2.5 buts"
    model_prob: float
    bookmaker_odds: float
    implied_prob: float
    edge: float
    ev: float
    kelly_stake_fraction: float
    confidence: float
    star_label: str
    star_count: int
    sample_size: int = 0
    bookmaker_spread_pct: float | None = None
    odds_only_mode: bool = False
    # Écart de rating Elo (avantage terrain inclus), positif en faveur du
    # domicile — purement informatif (Phase 7 : "les statistiques
    # utilisées"), n'entre dans aucun calcul de probabilité ci-dessus.
    elo_rating_gap: float | None = None


def build_value_bet(
    home_team: str,
    away_team: str,
    competition: str,
    match_datetime: str,
    market: str,
    selection: str,
    model_prob: float,
    bookmaker_odds: float,
    sample_size: int = 0,
    bookmaker_spread_pct: float | None = None,
    odds_only_mode: bool = False,
    kelly_multiplier: float = DEFAULT_KELLY_MULTIPLIER,
    elo_rating_gap: float | None = None,
) -> ValueBet:
    implied = implied_probability(bookmaker_odds)
    edge_value = edge(model_prob, implied)
    ev = expected_value(model_prob, bookmaker_odds)
    kelly = kelly_fraction(model_prob, bookmaker_odds, kelly_multiplier)
    score = confidence_score(edge_value, sample_size, bookmaker_spread_pct, odds_only_mode)
    label, stars = star_rating(score)

    return ValueBet(
        home_team=home_team,
        away_team=away_team,
        competition=competition,
        match_datetime=match_datetime,
        market=market,
        selection=selection,
        model_prob=round(model_prob, 4),
        bookmaker_odds=bookmaker_odds,
        implied_prob=round(implied, 4),
        edge=round(edge_value, 4),
        ev=round(ev, 4),
        kelly_stake_fraction=kelly,
        confidence=score,
        star_label=label,
        star_count=stars,
        sample_size=sample_size,
        bookmaker_spread_pct=bookmaker_spread_pct,
        odds_only_mode=odds_only_mode,
        elo_rating_gap=elo_rating_gap,
    )


def find_value_bets(candidates: list[ValueBet], min_edge: float = 0.02) -> list[ValueBet]:
    """Filtre les candidats sous le seuil d'edge minimum et trie par score
    de confiance décroissant — le classement final affiché (Phase 6:
    dashboard / Phase 10: résultat final)."""
    return sorted((c for c in candidates if c.edge >= min_edge), key=lambda c: c.confidence, reverse=True)
