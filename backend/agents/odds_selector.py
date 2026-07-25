"""Port de lib/agents/odds-selector.ts — 100% déterministe, aucun appel modèle.

Appelé en interne par agents/analyst.py:run_analyst_and_odds — un seul appel
visible depuis l'orchestrateur pour Analyste + Sélecteur de cotes.
"""
from agent_kernel import Blackboard, render_mission
from agent_kernel.types import AgentMission
from tools.odds_api import get_bookmaker_quotes, PRIORITY_BOOKMAKER_KEY

MISSION = AgentMission(
    role="odds-selector",
    label="le Sélecteur de cotes",
    responsibility=(
        "décider, à partir des picks candidats de l'Analyste, lesquels ont une cote fiable (consensus "
        "bookmakers) et comment ils composent les 3 combinés finaux (prudent/équilibré/audacieux) — "
        "décision finale sur ce qui est réellement publié."
    ),
    does_not=[
        "Ne sélectionne aucun nouveau match et ne calcule aucune tendance statistique — délégué à l'Analyste.",
        "Ne rédige pas le post Telegram — délégué au Rédacteur.",
        "Ne valide pas la qualité finale avant publication — cette décision revient à l'utilisateur depuis le dashboard.",
    ],
)

MAX_BOOKMAKER_SPREAD = 0.20

# Un combiné perd dès qu'UN pick perd — le NOMBRE de picks contrôle donc la
# probabilité de gain final bien plus que la cote individuelle.
# prudent  : peu de picks, cote basse par pick  → gagne la majorité du temps
# équilibré: nombre intermédiaire, cotes mixtes → compromis
# audacieux: plus de picks et/ou cotes hautes   → rare, mais gros gain
TIER_PICK_RANGE = {
    "prudent": {"min": 2, "max": 4},
    "equilibre": {"min": 5, "max": 8},
    "audacieux": {"min": 8, "max": 15},
}
MIN_PICKS_PER_COMBO = TIER_PICK_RANGE["prudent"]["min"]

ALL_TIERS = ["prudent", "equilibre", "audacieux"]


def _median(values: list[float]) -> float:
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return (s[mid - 1] + s[mid]) / 2 if n % 2 == 0 else s[mid]


def _match_label(pick: dict) -> str:
    return f"{pick['home_team']} - {pick['away_team']} ({pick['bet_type']})"


def _match_key(pick: dict) -> str:
    """Identifie le MATCH (pas le pick) — l'Analyste peut proposer plusieurs
    prédictions indépendantes sur un même match, mais un seul de ces picks
    doit finir dans UN combiné donné."""
    return f"{pick['home_team']}-{pick['away_team']}"


async def _select_reliable_odds(candidates: list[dict]) -> dict:
    """ÉTAPE 1 — cote fiable par pick candidat. Un pick déjà validé par
    l'Analyste peut être rejeté ici si le marché est jugé trop incertain
    (écart entre bookmakers > 20%) — le Sélecteur de cotes a le dernier mot."""
    reliable: list[dict] = []
    excluded: list[dict] = []

    for pick in candidates:
        quotes = await get_bookmaker_quotes(pick["home_team"], pick["away_team"], pick["bet_type"])

        if not quotes:
            excluded.append({"match": _match_label(pick), "bet_type": pick["bet_type"], "reason": "Aucune cote bookmaker disponible pour ce marché"})
            continue

        prices = [q.price for q in quotes]
        lo, hi = min(prices), max(prices)
        spread = (hi - lo) / lo

        if spread > MAX_BOOKMAKER_SPREAD:
            excluded.append(
                {
                    "match": _match_label(pick),
                    "bet_type": pick["bet_type"],
                    "reason": f"Écart entre bookmakers {spread * 100:.1f}% > {MAX_BOOKMAKER_SPREAD * 100}% — marché trop incertain",
                }
            )
            continue

        priority = next((q for q in quotes if q.bookmaker == PRIORITY_BOOKMAKER_KEY), None)
        final_odds = priority.price if priority else _median(prices)
        source = "1xBet (priorité 1)" if priority else f"médiane sur {len(quotes)} bookmakers"

        reliable.append({**pick, "odds": final_odds, "odds_source": source, "bookmaker_spread_pct": round(spread * 1000) / 10})

    return {"reliable": reliable, "excluded": excluded}


def _combined_odds_of(picks: list[dict]) -> float:
    total = 1.0
    for p in picks:
        total *= p["odds"]
    return round(total * 100) / 100


def _take_unique_by_match(sorted_picks: list[dict], count: int) -> list[dict]:
    """Un seul pick par match dans un même combiné."""
    result: list[dict] = []
    seen: set[str] = set()
    for pick in sorted_picks:
        if len(result) >= count:
            break
        key = _match_key(pick)
        if key in seen:
            continue
        seen.add(key)
        result.append(pick)
    return result


def _interleave_from_both_ends(sorted_asc: list[dict], count: int) -> list[dict]:
    """Alterne du bas puis du haut d'une liste triée par cote croissante —
    mélange équilibré des risques."""
    result: list[dict] = []
    seen: set[str] = set()
    lo, hi = 0, len(sorted_asc) - 1
    take_low = True

    while len(result) < count and lo <= hi:
        candidate = sorted_asc[lo] if take_low else sorted_asc[hi]
        if take_low:
            lo += 1
        else:
            hi -= 1

        key = _match_key(candidate)
        if key in seen:
            continue  # retente le même côté, pointeur déjà avancé

        seen.add(key)
        result.append(candidate)
        take_low = not take_low

    return result


def _build_combo(tier: str, picks: list[dict], reason_suffix: str, decisions: list[dict]) -> dict:
    for p in picks:
        decisions.append({"match": _match_label(p), "tier": tier, "included": True, "reason": f"Sélectionné — {reason_suffix}"})
    return {"tier": tier, "picks": picks, "combined_odds": _combined_odds_of(picks)}


def _compose_tiers(reliable: list[dict]) -> dict:
    """ÉTAPE 2 — composition des 3 combinés. Chaque palier a sa propre plage
    de nombre de picks, en plus de sa propre logique de cote."""
    combos: dict[str, dict] = {}
    decisions: list[dict] = []

    by_odds_asc = sorted(reliable, key=lambda p: p["odds"])
    by_odds_desc = list(reversed(by_odds_asc))
    # Le vrai plafond, c'est le nombre de MATCHS distincts.
    unique_match_count = len({_match_key(p) for p in reliable})

    for tier in ALL_TIERS:
        rng = TIER_PICK_RANGE[tier]

        if unique_match_count < rng["min"]:
            decisions.append(
                {
                    "match": "—",
                    "tier": tier,
                    "included": False,
                    "reason": f"Seulement {unique_match_count} matchs distincts avec cote fiable — minimum {rng['min']} requis pour le palier {tier}",
                }
            )
            continue

        count = min(rng["max"], unique_match_count)

        if tier == "prudent":
            combos["prudent"] = _build_combo("prudent", _take_unique_by_match(by_odds_asc, count), f"{count} picks à cote individuelle basse — vise à gagner majoritairement", decisions)
        elif tier == "audacieux":
            combos["audacieux"] = _build_combo("audacieux", _take_unique_by_match(by_odds_desc, count), f"{count} picks à cote individuelle haute — gain rare mais élevé", decisions)
        else:
            combos["equilibre"] = _build_combo("equilibre", _interleave_from_both_ends(by_odds_asc, count), f"{count} picks — mélange de cotes basses et hautes", decisions)

    return {"combos": combos, "decisions": decisions}


async def decide(candidates: list[dict], blackboard: Blackboard) -> dict:
    mission = render_mission(MISSION)  # documente la mission dans le journal des agents, pas un prompt LLM
    blackboard.write("odds-selector-mission", mission)

    selection = await _select_reliable_odds(candidates)
    reliable, excluded = selection["reliable"], selection["excluded"]

    blackboard.post(
        from_role="odds-selector",
        type="observation",
        content=f"{len(reliable)}/{len(candidates)} picks avec cote fiable — {len(excluded)} rejetés (marché incertain ou cote absente).",
    )

    composition = _compose_tiers(reliable)
    combos, decisions = composition["combos"], composition["decisions"]
    built_tiers = [t for t in ALL_TIERS if t in combos]

    for tier in ALL_TIERS:
        combo = combos.get(tier)
        content = (
            f"Palier {tier} : {len(combo['picks'])} picks, cote combinée {combo['combined_odds']}."
            if combo
            else f"Palier {tier} non généré aujourd'hui — moins de {TIER_PICK_RANGE[tier]['min']} picks fiables disponibles."
        )
        blackboard.post(from_role="odds-selector", to_role="writer", type="decision", content=content)

    if not built_tiers:
        blackboard.post(from_role="odds-selector", type="result", content="Aucun palier constructible aujourd'hui.")

    return {"reliable_picks": reliable, "excluded_picks": excluded, "combos": combos, "decisions": decisions}
