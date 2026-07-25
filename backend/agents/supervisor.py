"""Port de lib/agents/supervisor.ts.

Le Superviseur n'est plus un agent IA — l'utilisateur valide lui-même
chaque palier depuis le dashboard (bouton Approuver/Rejeter sur les
sessions en statut 'draft'). Ce module ne garde que les contrôles
structurels objectifs (pas de jugement qualitatif ni d'appel modèle) :
dernier filet de sécurité automatique avant que l'humain ne lise le post.
"""
from agent_kernel import Blackboard
from agents.odds_selector import TIER_PICK_RANGE

FORBIDDEN_WORDS = [
    # Promesses de gain non tenables
    "garanti", "garantine", "sûr à 100", "100% sûr", "certain à 100", "infaillible", "sans risque", "gagné d'avance", "coup sûr",
    # Langage familier / références inappropriées à la mort — jamais dans un contexte de paris
    "suicide", "roulette russe", "mortel", "de ouf",
]


def check_forbidden_words(text: str) -> list[str]:
    lower = text.lower()
    return [w for w in FORBIDDEN_WORDS if w in lower]


def check_tier_structure(combo: dict, writer_output: str, blackboard: Blackboard) -> dict:
    """Contrôles structurels déterministes uniquement (plage de picks, doublons,
    mots interdits). Ne juge ni le ton ni la cohérence du post — c'est
    désormais à l'utilisateur de lire le post et d'approuver/rejeter depuis
    le dashboard avant que la session ne devienne publiable."""
    issues: list[str] = []

    rng = TIER_PICK_RANGE[combo["tier"]]
    picks = combo["picks"]
    if len(picks) < rng["min"] or len(picks) > rng["max"]:
        issues.append(f"Nombre de picks hors plage pour le palier {combo['tier']} : {len(picks)} (attendu {rng['min']}–{rng['max']})")

    match_keys = [f"{p['home_team']}-{p['away_team']}" for p in picks]
    if len(match_keys) != len(set(match_keys)):
        issues.append("Doublons : même match sélectionné plusieurs fois dans ce combiné")

    forbidden = check_forbidden_words(writer_output)
    if forbidden:
        issues.append(f"Mots interdits dans le post : {', '.join(forbidden)}")

    if issues:
        result = {
            "verdict": "revision_needed",
            "issues": issues,
            "feedback": "Corrections obligatoires :\n" + "\n".join(f"• {i}" for i in issues),
        }
    else:
        result = {
            "verdict": "approved",
            "issues": [],
            "feedback": "Contrôles automatiques OK — en attente de ta validation manuelle.",
        }

    blackboard.post(
        from_role="supervisor",
        to_role="all" if result["verdict"] == "approved" else "writer",
        type="decision" if result["verdict"] == "approved" else "reflection",
        content=f"Palier {combo['tier']} — {result['feedback']}",
    )

    return result
