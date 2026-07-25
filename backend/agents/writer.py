"""Port de lib/agents/writer.ts."""
import os

from agent_kernel import AgentMission, Blackboard, RunBudget, call_agent_model, render_mission
from tools.display_format import shorten_bet_type

MISSION = AgentMission(
    role="writer",
    label="le Rédacteur",
    responsibility="rédiger le post Telegram d'un combiné déjà composé et fiabilisé par le Sélecteur de cotes.",
    does_not=[
        "Ne sélectionne, ne modifie, ni ne retire aucun pick du combiné.",
        "Ne décide pas si le combiné doit être publié — cette décision est déjà prise en amont.",
        "N'ajoute aucune promesse de gain non présente dans les données (garanti, sûr à 100%, etc.).",
    ],
)

TIER_LABELS = {
    "prudent": "Prudent",
    "equilibre": "Équilibré",
    "audacieux": "Audacieux",
}


async def run_writer(
    combo: dict,
    date: str,
    blackboard: Blackboard,
    budget: RunBudget,
    supervisor_feedback: str | None = None,
) -> str:
    picks_text = "\n".join(
        f"{i + 1}. {p['home_team']} VS {p['away_team']} ({p['competition']})\n"
        f"   → {shorten_bet_type(p['bet_type'])} @ {p['odds']:.2f} (cote {p['odds_source']})\n"
        f"   Tendance : {p['trend_label']}"
        for i, p in enumerate(combo["picks"])
    )

    tier_label = TIER_LABELS.get(combo["tier"], combo["tier"])
    avg_pick_odds = sum(p["odds"] for p in combo["picks"]) / len(combo["picks"])

    system = f"""{render_mission(MISSION)}

IA de Pronostics & Coupons est une chaîne Telegram de pronostics football PREMIUM — le
ton doit être celui d'une marque haut de gamme, pas d'un groupe de paris
entre potes.

TON : sobre, confiant, mesuré. Direct et percutant ne veut PAS dire familier.
INTERDIT ABSOLUMENT :
- Argot, langage de rue, expressions comme "le frisson", "du lourd", "ça envoie", "de ouf"
- Toute référence à la mort/au danger physique, même en expression figurée (ex: "suicide", "mortel", "roulette russe") — inacceptable dans un contexte de paris
- Points d'exclamation multiples, majuscules pour crier, emojis autres que les numéros de liste
Pour communiquer le niveau de risque d'un palier audacieux, utilise un vocabulaire mesuré : "ambitieux", "plus exigeant", "sélection à cote plus élevée" — jamais de sensationnalisme.

FORMAT HTML Telegram UNIQUEMENT :
- Gras : <b>texte</b>  ·  Italique : <i>texte</i>
- Aucune autre balise. N'utilise JAMAIS la syntaxe Markdown (*, _, `, [, ]).
- Ponctuation normale (., !, -, parenthèses) : jamais besoin de les échapper.
- Seuls les caractères & < > doivent être évités tels quels dans le texte libre (utilise "et" plutôt que "&" par exemple)."""

    feedback_block = (
        f"\nRETOUR DU SUPERVISEUR SUR LA TENTATIVE PRÉCÉDENTE — corrige précisément ces points, ne reproduis pas le même texte avec des changements cosmétiques :\n{supervisor_feedback}\n"
        if supervisor_feedback
        else ""
    )

    user_message = f"""Écris le post Telegram pour le combiné {tier_label} du {date} :

{picks_text}

Cote combinée : {combo['combined_odds']:.2f} ({len(combo['picks'])} matchs, cote moyenne par match {avg_pick_odds:.2f})

Structure du post :
1. Accroche sobre et confiante (1 ligne), mentionne le palier "{tier_label}" avec un vocabulaire mesuré — le risque se lit à la fois au NOMBRE DE MATCHS ({len(combo['picks'])}) et à la cote moyenne par match ({avg_pick_odds:.2f}) : prudent = peu de matchs, cote par match basse ("sélection prudente", conçue pour gagner plus souvent), audacieux = plus de matchs et/ou cote par match plus haute ("sélection ambitieuse", gain rare mais élevé quand ça passe, jamais de sensationnalisme)
2. Chaque pick avec emoji numéroté (1️⃣ 2️⃣ etc.), match en gras au format "Équipe A VS Équipe B" (VS en majuscules entre les deux noms), type de pari dans la notation courte fournie ci-dessus (1/X/2, Over/Under, BTTS — reconnue par tous les parieurs, ne la reformule pas en phrase longue), cote, tendance courte
3. Cote combinée mise en valeur, en rappelant que {len(combo['picks'])} résultats doivent tous se réaliser
4. CTA discret avec lien affilié : {os.environ.get('AFFILIATE_LINK', '')}
5. Disclaimer clair sur le pari responsable, proportionné à la cote moyenne par match — plus appuyé si le palier est audacieux
{feedback_block}
Réponds UNIQUEMENT avec le texte du post, prêt à envoyer."""

    result = await call_agent_model("writer", system, user_message, 800, blackboard, budget)
    text = result["text"]

    blackboard.post(from_role="writer", type="action", content=f'Post Telegram "{tier_label}" rédigé ({len(text)} caractères).')

    return text
