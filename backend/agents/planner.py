"""Port de lib/agents/planner.ts."""
from datetime import datetime

from agent_kernel import AgentMission, Blackboard, RunBudget, call_agent_model, parse_agent_json, render_mission
from tools.serper import search_trending_matches

COMPETITIONS = [
    "Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1",
    "Champions League", "Europa League", "Championship", "Liga Portugal", "Eredivisie",
    "Campeonato Brasileiro", "Copa Libertadores", "FIFA World Cup",
]

MISSION = AgentMission(
    role="planner",
    label="le Planificateur",
    responsibility=(
        "fixer le plan du jour : quelles compétitions et quels types de paris prioriser, avant toute "
        "analyse de données. S'appuie sur une recherche web pour ancrer ce plan sur les matchs "
        "réellement au programme, pas uniquement sur sa connaissance générale."
    ),
    does_not=[
        "Ne sélectionne aucun pick — délégué à l'Analyste.",
        "Ne consulte aucune donnée de cote — décide sur la base du calendrier, du jour de la semaine et des matchs identifiés sur le web.",
        "Ne valide ni ne publie rien.",
    ],
)


async def run_planner(date: str, blackboard: Blackboard, budget: RunBudget) -> dict:
    day_name = datetime.fromisoformat(date).strftime("%A")
    date_label = datetime.fromisoformat(date).strftime("%d %B %Y")
    # Heure RÉELLE d'exécution du run — distincte de `date` (la journée
    # ciblée par l'analyse, qui peut être future).
    now = datetime.utcnow()
    now_label = now.strftime("%A %d %B %Y à %H:%M")

    trending_results = await search_trending_matches(date_label)
    trending_context = (
        "\n".join(f"[{r.get('source') or 'Source'}] {r['title']}: {r['snippet']}" for r in trending_results)
        if trending_results
        else "Aucun résultat de recherche web exploitable — retombe sur le calendrier connu des compétitions listées."
    )

    blackboard.post(
        from_role="planner",
        type="observation",
        content=f"{len(trending_results)} résultats de recherche web sur les matchs du jour.",
    )

    system = f"""{render_mission(MISSION)}

Tu analyses le calendrier football du jour et produis un plan JSON structuré.
Réponds UNIQUEMENT avec du JSON valide, sans markdown ni commentaire."""

    user_message = f"""Date ciblée par cette analyse : {date} ({day_name})
Heure réelle d'exécution de ce run : {now_label} (UTC) — sers-t'en pour juger si la journée ciblée est déjà bien avancée (peu de matchs encore à venir) ou encore à venir, pas pour changer la date ciblée elle-même.
Compétitions disponibles : {', '.join(COMPETITIONS)}

Résultats de recherche web sur les matchs/pronostics du jour ({len(trending_results)} résultats) :
{trending_context}

Génère un plan JSON avec la structure suivante :
{{
  "date": "{date}",
  "competitions": ["liste des compétitions prioritaires pour aujourd'hui (3-5)"],
  "focus_areas": ["types de paris à prioriser selon le jour (ex: over 2.5 weekend, under 1.5 midweek)"],
  "trending_matches": ["10 à 15 affiches identifiées dans les résultats de recherche ci-dessus, au format 'Équipe A vs Équipe B' — liste vide si aucun résultat exploitable, n'invente rien"],
  "context": "contexte général du jour en 1-2 phrases (ex: journée chargée Ligue des Champions, derbies attendus...)",
  "reasoning": "pourquoi ce plan (1 phrase, ta réflexion)"
}}"""

    result = await call_agent_model("planner", system, user_message, 768, blackboard, budget)
    text, model_used = result["text"], result["model_used"]

    # Signalé explicitement comme un repli — sans ça, un échec de parsing du
    # modèle produisait un plan générique indiscernable d'un vrai raisonnement
    # daté.
    fallback = {
        "date": date,
        "competitions": ["Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1"],
        "focus_areas": ["over 2.5", "btts oui", "victoire domicile"],
        "trending_matches": [],
        "context": f"Plan de secours pour le {date_label} — réponse du modèle illisible, repli sur les grands championnats par défaut.",
        "model_used": model_used,
    }
    parsed = parse_agent_json(text, fallback)
    output = {**parsed, "model_used": model_used}

    blackboard.post(
        from_role="planner",
        to_role="analyst",
        type="plan",
        content=(
            f"Focus: {', '.join(output.get('focus_areas', []))} sur {', '.join(output.get('competitions', []))} "
            f"— {len(output.get('trending_matches', []))} affiches tendance identifiées — {output.get('context', '')}"
        ),
    )

    return output
