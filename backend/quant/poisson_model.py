"""Modèles Poisson et Dixon-Coles — nombre de buts attendu par équipe et
distribution de score complète.

Deux façons d'estimer la force offensive/défensive d'une équipe, choisies
selon les données réellement disponibles :

1. `fit_dixon_coles_mle` — l'ajustement Dixon-Coles (1997) complet par
   maximum de vraisemblance, joint sur TOUTES les équipes d'un jeu de
   données. C'est la méthode statistiquement rigoureuse, mais elle a besoin
   d'un historique large et croisé entre équipes (idéalement une saison
   complète d'un championnat) pour être fiable — pas juste les ~15 derniers
   matchs de deux équipes prises isolément.
2. `estimate_team_strength_simple` — une estimation par ratio (force
   offensive = buts marqués par l'équipe / moyenne de la ligue, idem
   défense), utilisable avec seulement l'historique récent de CHAQUE équipe
   prise séparément (ce que la collecte actuelle via tools/football_api.py
   fournit réellement, historique limité à ~15 matchs par équipe, pas un
   jeu de données croisé sur tout un championnat). C'est la méthode
   effectivement utilisée par le pipeline aujourd'hui (voir
   agents/quant_analyst.py) — `fit_dixon_coles_mle` reste disponible pour
   le jour où une collecte d'historique de championnat plus large existe.

Dans les deux cas, le résultat final (lambda_home, lambda_away) alimente
quant/monte_carlo.py pour produire les probabilités de marché — jamais une
conversion directe d'un ratio en probabilité.
"""
from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize
from scipy.stats import poisson

from .types import HistoricalMatch

# Dixon & Coles (1997) rapportent rho ≈ -0.13 sur les données de leur étude
# (Premier League/Division 1 anglaise, saisons 1992-1995) — valeur de repli
# quand l'échantillon est trop petit pour un ajustement MLE fiable du rho
# propre à ce jeu de données.
DEFAULT_RHO = -0.13
# Moyenne long terme approximative, buts marqués par équipe par match, sur
# les 5 grands championnats européens — repli si aucune moyenne de ligue
# calculable à partir des données disponibles.
DEFAULT_LEAGUE_AVG_GOALS = 1.4
# Avantage du terrain multiplicatif par défaut (une équipe à domicile
# marque ~35% de buts en plus qu'à l'extérieur, ordre de grandeur standard
# en football professionnel).
DEFAULT_HOME_ADVANTAGE = 1.35
# Taux de décroissance temporelle Dixon-Coles (1997) — pondère les matchs
# récents plus fort qu'un match d'il y a un an dans le MLE joint.
XI_TIME_DECAY = 0.0018
# En dessous de ce nombre de matchs dans le jeu de données joint, le MLE
# Dixon-Coles est jugé statistiquement peu fiable (trop peu de contraintes
# croisées entre équipes) — fit_dixon_coles_mle lève alors ValueError,
# l'appelant doit se rabattre sur estimate_team_strength_simple.
MIN_MATCHES_FOR_MLE = 100


@dataclass
class TeamStrength:
    attack: float
    defense: float


@dataclass
class DixonColesModel:
    teams: dict[str, TeamStrength]
    home_advantage: float
    rho: float
    league_avg_goals: float


def blended_goals(actual_goals: int, xg: float | None, xg_weight: float = 0.5) -> float:
    """Mélange buts réels et xG pour réduire le bruit d'échantillon — les
    buts réels sont "bruyants" match par match (un tir sur la barre qui
    rentre ou pas), xG est un meilleur estimateur de la performance
    sous-jacente sur un petit échantillon. Sans xG disponible (Understat
    indisponible ou championnat non couvert), retombe sur les buts réels
    seuls."""
    if xg is None:
        return float(actual_goals)
    return xg_weight * xg + (1 - xg_weight) * actual_goals


def dixon_coles_tau(x: int, y: int, lam: float, mu: float, rho: float) -> float:
    """Correction de corrélation Dixon-Coles pour les scores faibles (0-0,
    1-0, 0-1, 1-1) — un Poisson bivarié indépendant sous-estime légèrement
    la fréquence réelle des matchs nuls à faible score."""
    if x == 0 and y == 0:
        return 1 - lam * mu * rho
    if x == 0 and y == 1:
        return 1 + lam * rho
    if x == 1 and y == 0:
        return 1 + mu * rho
    if x == 1 and y == 1:
        return 1 - rho
    return 1.0


def score_matrix(lam: float, mu: float, rho: float, max_goals: int = 10) -> np.ndarray:
    """Grille de probabilité jointe P(buts domicile=i, buts extérieur=j),
    corrigée Dixon-Coles et renormalisée (la correction tau peut légèrement
    déplacer la masse totale hors de 1 pour rho extrême)."""
    home_pmf = poisson.pmf(np.arange(max_goals + 1), lam)
    away_pmf = poisson.pmf(np.arange(max_goals + 1), mu)
    grid = np.outer(home_pmf, away_pmf)

    for i in range(2):
        for j in range(2):
            grid[i, j] *= dixon_coles_tau(i, j, lam, mu, rho)

    grid = np.clip(grid, 0, None)
    total = grid.sum()
    return grid / total if total > 0 else grid


def estimate_team_strength_simple(
    goals_for: list[float],
    goals_against: list[float],
    league_avg_goals: float = DEFAULT_LEAGUE_AVG_GOALS,
) -> TeamStrength:
    """Force offensive/défensive par ratio à la moyenne de la ligue —
    utilisable avec seulement l'historique récent d'UNE équipe (pas besoin
    d'un jeu de données croisé sur tout un championnat). `goals_for` /
    `goals_against` peuvent déjà être mélangés aux xG via `blended_goals`."""
    if not goals_for or not goals_against or league_avg_goals <= 0:
        return TeamStrength(attack=1.0, defense=1.0)

    avg_scored = sum(goals_for) / len(goals_for)
    avg_conceded = sum(goals_against) / len(goals_against)

    return TeamStrength(
        attack=round(avg_scored / league_avg_goals, 3),
        defense=round(avg_conceded / league_avg_goals, 3),
    )


def expected_goals(
    home_strength: TeamStrength,
    away_strength: TeamStrength,
    league_avg_goals: float = DEFAULT_LEAGUE_AVG_GOALS,
    home_advantage: float = DEFAULT_HOME_ADVANTAGE,
) -> tuple[float, float]:
    """(lambda_home, lambda_away) pour des forces issues de
    `estimate_team_strength_simple` (ratios à la moyenne de ligue — attack=1.0
    signifie "attaque dans la moyenne"). Pas utilisable avec un
    DixonColesModel issu de `fit_dixon_coles_mle`, dont les forces sont sur
    une autre échelle (voir `expected_goals_from_model` ci-dessous)."""
    lam = league_avg_goals * home_strength.attack * away_strength.defense * home_advantage
    mu = league_avg_goals * away_strength.attack * home_strength.defense
    return round(lam, 3), round(mu, 3)


def expected_goals_from_model(model: DixonColesModel, home_team: str, away_team: str) -> tuple[float, float]:
    """(lambda_home, lambda_away) pour un DixonColesModel issu de
    `fit_dixon_coles_mle` — les forces y sont déjà normalisées (moyenne
    géométrique 1 sur l'attaque) et l'avantage terrain y est déjà un
    multiplicateur autonome, sans facteur `league_avg_goals` séparé
    (contrairement à `estimate_team_strength_simple` + `expected_goals`)."""
    home = model.teams.get(home_team, TeamStrength(attack=1.0, defense=1.0))
    away = model.teams.get(away_team, TeamStrength(attack=1.0, defense=1.0))
    lam = model.home_advantage * home.attack * away.defense
    mu = away.attack * home.defense
    return round(lam, 3), round(mu, 3)


def _neg_log_likelihood(params: np.ndarray, home_idx: np.ndarray, away_idx: np.ndarray, home_goals: np.ndarray, away_goals: np.ndarray, weights: np.ndarray, n_teams: int) -> float:
    attack = params[:n_teams]
    defense = params[n_teams : 2 * n_teams]
    home_adv = params[2 * n_teams]
    rho = params[2 * n_teams + 1]

    lam = np.exp(attack[home_idx] + defense[away_idx] + home_adv)
    mu = np.exp(attack[away_idx] + defense[home_idx])

    ll = weights * (poisson.logpmf(home_goals, lam) + poisson.logpmf(away_goals, mu))

    # Correction Dixon-Coles — seuls les scores faibles (0-0/1-0/0-1/1-1)
    # sont affectés, calculée match par match (boucle Python volontaire :
    # ne concerne qu'un sous-ensemble des matchs, pas la boucle principale).
    for i in range(len(home_goals)):
        x, y = int(home_goals[i]), int(away_goals[i])
        if x <= 1 and y <= 1:
            tau = dixon_coles_tau(x, y, lam[i], mu[i], rho)
            if tau <= 0:
                tau = 1e-10
            ll[i] += weights[i] * np.log(tau)

    return -ll.sum()


def fit_dixon_coles_mle(matches: list[HistoricalMatch], xi: float = XI_TIME_DECAY) -> DixonColesModel:
    """Ajustement Dixon-Coles complet par maximum de vraisemblance, joint
    sur toutes les équipes de `matches`. Lève ValueError si l'échantillon
    est trop petit (< MIN_MATCHES_FOR_MLE) pour un ajustement statistiquement
    fiable — l'appelant doit alors utiliser estimate_team_strength_simple.
    """
    if len(matches) < MIN_MATCHES_FOR_MLE:
        raise ValueError(f"Échantillon trop petit pour un ajustement Dixon-Coles fiable ({len(matches)} < {MIN_MATCHES_FOR_MLE}).")

    sorted_matches = sorted(matches, key=lambda m: m.date)
    most_recent = sorted_matches[-1].date

    teams = sorted({m.home_team for m in matches} | {m.away_team for m in matches})
    team_index = {team: i for i, team in enumerate(teams)}
    n_teams = len(teams)

    home_idx = np.array([team_index[m.home_team] for m in sorted_matches])
    away_idx = np.array([team_index[m.away_team] for m in sorted_matches])
    home_goals = np.array([m.home_goals for m in sorted_matches], dtype=float)
    away_goals = np.array([m.away_goals for m in sorted_matches], dtype=float)

    from datetime import datetime

    def days_ago(date_str: str) -> float:
        try:
            delta = datetime.fromisoformat(most_recent.replace("Z", "+00:00")) - datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            return max(delta.days, 0)
        except ValueError:
            return 0.0

    weights = np.array([np.exp(-xi * days_ago(m.date)) for m in sorted_matches])

    # Point de départ : forces égales (log(1)=0), avantage terrain modéré,
    # rho de repli — évite tout biais de démarrage arbitraire.
    initial = np.zeros(2 * n_teams + 2)
    initial[2 * n_teams] = np.log(DEFAULT_HOME_ADVANTAGE)
    initial[2 * n_teams + 1] = DEFAULT_RHO

    bounds = [(-3, 3)] * (2 * n_teams) + [(-1, 2), (-0.5, 0.5)]

    result = minimize(
        _neg_log_likelihood,
        initial,
        args=(home_idx, away_idx, home_goals, away_goals, weights, n_teams),
        method="L-BFGS-B",
        bounds=bounds,
    )

    params = result.x
    attack = params[:n_teams]
    defense = params[n_teams : 2 * n_teams]
    home_adv_log = params[2 * n_teams]
    rho = params[2 * n_teams + 1]

    # Normalisation pour l'interprétabilité (invariant du point de vue des
    # prédictions — voir la dérivation dans le docstring du module) :
    # attack_i -= mean(attack), defense_i += mean(attack).
    mean_attack = attack.mean()
    attack = attack - mean_attack
    defense = defense + mean_attack

    league_avg_goals = float(np.concatenate([home_goals, away_goals]).mean())

    teams_strength = {
        team: TeamStrength(attack=round(float(np.exp(attack[i])), 3), defense=round(float(np.exp(defense[i])), 3))
        for team, i in team_index.items()
    }

    return DixonColesModel(
        teams=teams_strength,
        home_advantage=round(float(np.exp(home_adv_log)), 3),
        rho=round(float(rho), 4),
        league_avg_goals=round(league_avg_goals, 3),
    )
