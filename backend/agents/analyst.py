"""Port de lib/agents/analyst.ts."""
import asyncio

from agent_kernel import Blackboard, RunBudget, call_agent_model, load_medium_term_digest, parse_agent_json, render_mission
from agent_kernel.types import AgentMission
from tools.football_api import TeamMatchResult, TodayMatch, build_match_analysis_data, get_today_matches
from tools.odds_api import MatchOdds, find_match_odds, get_today_odds, is_known_league
from tools.serper import check_team_news

from .odds_selector import decide as decide_odds

MIN_TREND_PCT = 80
MIN_SAMPLE = 8
MIN_ODDS = 1.35
# Plafond volontairement large : la composition des 3 combinés est décidée
# en aval par le Sélecteur de cotes, qui a besoin d'assez de matière.
MAX_ODDS = 6.0
MAX_PICKS = 20
NEWS_FETCH_CONCURRENCY = 5
GOAL_LINES = [1.5, 2.5, 3.5]

MISSION = AgentMission(
    role="analyst",
    label="l'Analyste",
    responsibility=(
        "sélectionner les picks football à haute valeur statistique à partir des données fournies "
        "(API-Football, cotes, actualités), en respectant strictement les seuils de tendance et de "
        "cote. Délègue ensuite en interne au Sélecteur de cotes (déterministe, sans LLM) la "
        "vérification des cotes bookmaker et la composition des 3 combinés — un seul appel depuis "
        "l'orchestrateur pour les deux étapes."
    ),
    does_not=[
        "Ne planifie pas les compétitions/focus du jour — délégué au Planner.",
        "Ne valide pas la qualité finale du combiné — cette décision revient à l'utilisateur depuis le dashboard.",
        "Ne rédige pas le post Telegram — délégué au Writer.",
        "N'invente jamais une statistique non présente dans les données fournies.",
    ],
)


async def _map_with_concurrency(items: list, limit: int, fn) -> list:
    """Traite `items` avec au plus `limit` appels de `fn` en vol simultanément,
    en conservant l'ordre des résultats. Aucune limite de débit connue côté
    Serper (contrairement à API-Football, qui ne doit jamais passer par ici)."""
    results = [None] * len(items)
    sem = asyncio.Semaphore(limit)

    async def worker(i, item):
        async with sem:
            results[i] = await fn(item)

    await asyncio.gather(*(worker(i, item) for i, item in enumerate(items)))
    return results


def _calc_trend(history: list[TeamMatchResult], predicate) -> dict:
    if not history:
        return {"pct": 0, "count": 0}
    matching = len([m for m in history if predicate(m)])
    return {"pct": round((matching / len(history)) * 100), "count": len(history)}


def _win_streak(history: list[TeamMatchResult]) -> int:
    streak = 0
    for m in history:
        if m.result != "W":
            break
        streak += 1
    return streak


def _unbeaten_streak(history: list[TeamMatchResult], n: int) -> bool:
    recent = history[:n]
    return len(recent) == n and all(m.result != "L" for m in recent)


def _form_points(history: list[TeamMatchResult], n: int) -> dict:
    recent = history[:n]
    points = sum(3 if m.result == "W" else (1 if m.result == "D" else 0) for m in recent)
    return {"points": points, "max": len(recent) * 3}


def _avg_goals(history: list[TeamMatchResult], n: int, key: str) -> float:
    recent = history[:n]
    if not recent:
        return 0.0
    return round((sum(getattr(m, key) for m in recent) / len(recent)) * 10) / 10


def _goal_line_trends(history: list[TeamMatchResult]) -> str:
    return ", ".join(f"over{line}={_calc_trend(history, lambda m, l=line: m.total_goals > l)['pct']}%" for line in GOAL_LINES)


def _odds_lines(match_odds: MatchOdds) -> list[str]:
    lines = []
    home, draw, away = match_odds.h2h["home"], match_odds.h2h["draw"], match_odds.h2h["away"]
    if home is not None and MIN_ODDS <= home <= MAX_ODDS:
        lines.append(f"Victoire domicile: {home:.2f}")
    if draw is not None and MIN_ODDS <= draw <= MAX_ODDS:
        lines.append(f"Match nul: {draw:.2f}")
    if away is not None and MIN_ODDS <= away <= MAX_ODDS:
        lines.append(f"Victoire extérieur: {away:.2f}")
    for total in match_odds.totals:
        if total.over is not None and MIN_ODDS <= total.over <= MAX_ODDS:
            lines.append(f"Plus de {total.point}: {total.over:.2f}")
        if total.under is not None and MIN_ODDS <= total.under <= MAX_ODDS:
            lines.append(f"Moins de {total.point}: {total.under:.2f}")
    yes, no = match_odds.btts.get("yes"), match_odds.btts.get("no")
    if yes is not None and MIN_ODDS <= yes <= MAX_ODDS:
        lines.append(f"BTTS Oui: {yes:.2f}")
    if no is not None and MIN_ODDS <= no <= MAX_ODDS:
        lines.append(f"BTTS Non: {no:.2f}")
    hp, hpr, ap, apr = (match_odds.spreads.get(k) for k in ("home_point", "home_price", "away_point", "away_price"))
    if hp is not None and hpr is not None and MIN_ODDS <= hpr <= MAX_ODDS:
        lines.append(f"Handicap {match_odds.home_team} {'+' if hp >= 0 else ''}{hp}: {hpr:.2f}")
    if ap is not None and apr is not None and MIN_ODDS <= apr <= MAX_ODDS:
        lines.append(f"Handicap {match_odds.away_team} {'+' if ap >= 0 else ''}{ap}: {apr:.2f}")
    return lines


async def gather_analyst_context(date: str, blackboard: Blackboard) -> dict:
    """Phase de PERCEPTION — tous les appels d'outils coûteux (API-Football
    rate-limitée à 7s/appel, cotes, actualités). Exécutée UNE SEULE FOIS par
    run. Prend `date` directement (pas plannerOutput) pour tourner en
    parallèle du Planificateur."""
    odds, memory_context = await asyncio.gather(get_today_odds("eu", date), asyncio.to_thread(load_medium_term_digest))

    analysis_data = []
    odds_only_mode = False

    try:
        matches: list[TodayMatch] = await get_today_matches(date)
        if matches:
            analysis_data = await build_match_analysis_data(matches)
    except Exception as err:
        print(f"[analyst] API-Football indisponible (quota ou erreur) — mode cotes uniquement: {err}")
        odds_only_mode = True

    if not analysis_data:
        odds_only_mode = True

    enriched: list[str] = []
    team_logos: dict[str, str] = {}

    if not odds_only_mode:
        for data in analysis_data:
            team_logos[data.match.home_team.name.strip().lower()] = data.match.home_team.logo
            team_logos[data.match.away_team.name.strip().lower()] = data.match.away_team.logo

        async def per_match(data):
            match_odds = find_match_odds(odds, data.match.home_team.name, data.match.away_team.name)
            if not match_odds:
                return None

            home_h, away_h = data.home_team_last_matches, data.away_team_last_matches

            away_btts = _calc_trend(away_h, lambda m: m.goals_for > 0 and m.goals_against > 0)
            home_btts = _calc_trend(home_h, lambda m: m.goals_for > 0 and m.goals_against > 0)
            home_wins = _calc_trend(home_h, lambda m: m.result == "W" and m.home)
            away_wins = _calc_trend(away_h, lambda m: m.result == "W" and not m.home)
            home_draws = _calc_trend(home_h, lambda m: m.result == "D")
            away_draws = _calc_trend(away_h, lambda m: m.result == "D")
            home_clean_sheet = _calc_trend(home_h, lambda m: m.goals_against == 0)
            away_clean_sheet = _calc_trend(away_h, lambda m: m.goals_against == 0)
            home_big_win = _calc_trend(home_h, lambda m: m.result == "W" and (m.goals_for - m.goals_against) >= 2)
            home_form5 = _form_points(home_h, 5)
            away_form5 = _form_points(away_h, 5)

            lines = _odds_lines(match_odds)
            if not lines:
                return None

            home_news, away_news = await asyncio.gather(
                check_team_news(data.match.home_team.name), check_team_news(data.match.away_team.name)
            )

            return f"""MATCH: {data.match.home_team.name} vs {data.match.away_team.name} ({data.match.competition}) — {data.match.datetime}
Domicile {data.match.home_team.name} ({len(home_h)} matchs): {_goal_line_trends(home_h)}, btts={home_btts['pct']}%, wins_home={home_wins['pct']}%, nul={home_draws['pct']}%, cage_inviolee={home_clean_sheet['pct']}%, victoire_large(2+ buts)={home_big_win['pct']}%
Extérieur {data.match.away_team.name} ({len(away_h)} matchs): {_goal_line_trends(away_h)}, btts={away_btts['pct']}%, wins_ext={away_wins['pct']}%, nul={away_draws['pct']}%, cage_inviolee={away_clean_sheet['pct']}%
Forme récente {data.match.home_team.name} (5 derniers): {home_form5['points']}/{home_form5['max']} pts, {_avg_goals(home_h, 5, 'goals_for')} buts marqués/match, {_avg_goals(home_h, 5, 'goals_against')} encaissés/match, série de victoires en cours={_win_streak(home_h)}, invaincu sur 5={'oui' if _unbeaten_streak(home_h, 5) else 'non'}
Forme récente {data.match.away_team.name} (5 derniers): {away_form5['points']}/{away_form5['max']} pts, {_avg_goals(away_h, 5, 'goals_for')} buts marqués/match, {_avg_goals(away_h, 5, 'goals_against')} encaissés/match, série de victoires en cours={_win_streak(away_h)}, invaincu sur 5={'oui' if _unbeaten_streak(away_h, 5) else 'non'}
Actualités {data.match.home_team.name}: {home_news}
Actualités {data.match.away_team.name}: {away_news}
Cotes disponibles ({MIN_ODDS}–{MAX_ODDS}): {', '.join(lines)}"""

        per_match_results = await _map_with_concurrency(analysis_data, NEWS_FETCH_CONCURRENCY, per_match)
        enriched.extend([line for line in per_match_results if line is not None])
    else:
        # Sans API-Football pour recadrer la sélection, on se limite aux
        # championnats reconnaissables.
        known_league_odds = [o for o in odds if is_known_league(o.sport_key)][:20]

        async def per_event(event):
            lines = _odds_lines(event)
            if not lines:
                return None

            home_news, away_news = await asyncio.gather(check_team_news(event.home_team), check_team_news(event.away_team))

            implied_probs = []
            for line in lines:
                odds_val = float(line.split(": ")[1])
                implied_probs.append(f"{line} (prob. implicite: {round((1 / odds_val) * 100)}%)")

            return f"""MATCH: {event.home_team} vs {event.away_team} — {event.commence_time}
[MODE COTES UNIQUEMENT — données historiques indisponibles]
Actualités {event.home_team}: {home_news}
Actualités {event.away_team}: {away_news}
Cotes disponibles ({MIN_ODDS}–{MAX_ODDS}) avec probabilité implicite : {', '.join(implied_probs)}"""

        per_event_results = await _map_with_concurrency(known_league_odds, NEWS_FETCH_CONCURRENCY, per_event)
        enriched.extend([line for line in per_event_results if line is not None])

    blackboard.post(
        from_role="analyst",
        type="observation",
        content=f"{len(enriched)} matchs analysés (mode {'cotes seules' if odds_only_mode else 'complet'}).",
    )

    return {"enriched": enriched, "odds_only_mode": odds_only_mode, "memory_context": memory_context, "team_logos": team_logos}


async def reason_analyst_picks(
    planner_output: dict, context: dict, supervisor_feedback: str | None, blackboard: Blackboard, budget: RunBudget
) -> dict:
    """Phase de RAISONNEMENT — un appel modèle, réutilisant le contexte déjà perçu."""
    enriched = context["enriched"]
    odds_only_mode = context["odds_only_mode"]
    memory_context = context["memory_context"]
    team_logos = context["team_logos"]

    if not enriched:
        return {"picks_retenus": [], "picks_rejetés": [], "summary": "Aucun match éligible trouvé pour aujourd'hui.", "model_used": "none"}

    mission = render_mission(MISSION)
    long_term_memory = blackboard.read("longTermMemory") or "Aucune leçon long terme enregistrée."
    feedback_block = f"FEEDBACK SUPERVISEUR :\n{supervisor_feedback}\n" if supervisor_feedback else ""
    feedback_block_padded = f"\n{feedback_block}" if feedback_block else ""

    if odds_only_mode:
        system_prompt = f"""{mission}

MÉMOIRE LONG TERME (leçons des runs précédents) :
{long_term_memory}

Les données historiques API-Football sont temporairement indisponibles.
Tu travailles en MODE COTES UNIQUEMENT : les cotes de marché (bookmakers agrégés) sont ta seule source quantitative.

RÈGLES EN MODE COTES :
- Les cotes reflètent la probabilité implicite calculée sur des milliers de matchs. Une cote < 1.60 = probabilité > 62% selon le marché.
- Source statistique autorisée : cotes uniquement. Jamais de chiffre inventé ou issu des actualités Serper.
- Actualités Serper : contexte qualitatif UNIQUEMENT (blessures, suspensions). Aucune stat.
- Retiens {MAX_PICKS} picks maximum avec les cotes les plus basses (consensus marché le plus fort).
- trend_pct = probabilité implicite déjà calculée et fournie dans les données (ex: 65)
- sample_size = 0 OBLIGATOIRE (pas de données historiques)

{feedback_block}
Réponds UNIQUEMENT avec un objet JSON valide :
{{
  "plan": "string (stratégie suivie pour cette sélection, 1 phrase)",
  "picks_retenus": [
    {{
      "competition": "string", "home_team": "string", "away_team": "string", "match_datetime": "ISO 8601",
      "bet_type": "string", "odds": number, "trend_label": "string (ex: Cote marché 1.55 = 65% probabilité implicite)",
      "trend_pct": number, "sample_size": 0
    }}
  ],
  "picks_rejetés": [{{ "match": "string", "competition": "string", "bet_type": "string", "raison": "string" }}],
  "summary": "string"
}}"""
    else:
        system_prompt = f"""{mission}

SOURCES DE DONNÉES :
- API-Football (champs Domicile/Extérieur avec %) : SEULE source pour les statistiques chiffrées.
- Serper (champ Actualités) : contexte QUALITATIF uniquement — blessures, suspensions. Jamais de stat.

TYPES DE PARI DISPONIBLES (avec cote réelle) : Victoire domicile, Victoire extérieur, Match nul, Plus de/Moins de (ligne de buts — 1.5, 2.5 ou 3.5 selon ce qui est réellement proposé dans les cotes disponibles ci-dessous, jamais supposer que 2.5 est la seule ligne), Handicap.
PLUSIEURS PICKS SUR LE MÊME MATCH AUTORISÉS : si un match a plusieurs tendances indépendantes qui respectent chacune la règle 1, propose les DEUX comme picks candidats séparés plutôt que de forcer un choix arbitraire. Le Sélecteur de cotes se charge ensuite de n'en garder qu'un seul par match dans un même combiné.
- Plus de/Moins de : reprends EXACTEMENT la ligne présente dans les cotes disponibles. Justifie-le avec la tendance overX.X correspondant à la même ligne.
- Handicap : reprends EXACTEMENT le libellé et la valeur de la ligne fournie dans les cotes disponibles, n'invente jamais une ligne absente des données. Justifie-le avec victoire_large.
TENDANCES DE CONTEXTE (jamais un type de pari en soi, mais renforcent ou affaiblissent ta confiance) : nul, cage_inviolee, victoire_large, forme récente — utilise-les pour départager deux picks proches, jamais pour justifier un pick qui ne respecte pas la règle 1 ci-dessous.

RÈGLES ABSOLUES :
1. Tendance ≥ {MIN_TREND_PCT}% sur ≥ {MIN_SAMPLE} matchs (API-Football uniquement) — s'applique au type de pari choisi, pas à une tendance de contexte
2. Cote entre {MIN_ODDS} et {MAX_ODDS}
3. Maximum {MAX_PICKS} picks
4. Blessure/suspension clé détectée = pick rejeté

MÉMOIRE MOYEN TERME (30 derniers jours) : {memory_context or 'Aucun historique.'}
MÉMOIRE LONG TERME (leçons des runs précédents) : {long_term_memory}
{feedback_block_padded}
Réponds UNIQUEMENT JSON :
{{
  "plan": "string (stratégie suivie pour cette sélection, 1 phrase)",
  "picks_retenus": [
    {{ "competition": "string", "home_team": "string", "away_team": "string", "match_datetime": "ISO 8601",
      "bet_type": "string", "odds": number, "trend_label": "string", "trend_pct": number, "sample_size": number }}
  ],
  "picks_rejetés": [{{ "match": "string", "competition": "string", "bet_type": "string", "raison": "string" }}],
  "summary": "string"
}}"""

    trending_line = ""
    if planner_output.get("trending_matches"):
        trending_line = (
            "Affiches identifiées par recherche web comme notables aujourd'hui (priorise-les si elles apparaissent "
            "dans les données ci-dessous, sans jamais assouplir les seuils pour les inclure) : "
            + ", ".join(planner_output["trending_matches"])
        )

    user_message = f"""Focus du jour : {', '.join(planner_output.get('focus_areas', []))}
Contexte : {planner_output.get('context', '')}
{trending_line}

Données des matchs :
{chr(10).join(enriched)}
"""

    result = await call_agent_model("analyst", system_prompt, user_message, 4096, blackboard, budget)
    text, model_used = result["text"], result["model_used"]

    fallback = {
        "picks_retenus": [],
        "picks_rejetés": [],
        "summary": "Erreur de parsing JSON dans la réponse de l'analyste.",
        "model_used": model_used,
    }
    parsed = parse_agent_json(text, fallback)

    picks = parsed.get("picks_retenus", [])
    if odds_only_mode:
        valid_picks = [p for p in picks if MIN_ODDS <= p.get("odds", 0) <= MAX_ODDS]
    else:
        valid_picks = [
            p
            for p in picks
            if p.get("trend_pct", 0) >= MIN_TREND_PCT
            and p.get("sample_size", 0) >= MIN_SAMPLE
            and MIN_ODDS <= p.get("odds", 0) <= MAX_ODDS
        ]

    # Logo attaché par lookup sur les données API-Football déjà collectées —
    # jamais généré par le LLM, qui ne connaît aucune URL de logo réelle.
    picks_with_logos = [
        {
            **p,
            "home_team_logo": team_logos.get(p["home_team"].strip().lower()),
            "away_team_logo": team_logos.get(p["away_team"].strip().lower()),
        }
        for p in valid_picks
    ]

    return {**parsed, "picks_retenus": picks_with_logos, "model_used": model_used}


async def run_analyst_and_odds(date: str, planner_task: asyncio.Task, blackboard: Blackboard, budget: RunBudget) -> dict:
    """Point d'entrée unique pour l'orchestrateur — fusionne Analyste
    (perception + raisonnement LLM) et Sélecteur de cotes (déterministe) en
    une seule étape de pipeline.

    `planner_task` (un asyncio.Task déjà démarré, awaitable plusieurs fois)
    plutôt qu'un plan déjà résolu : la perception ne dépend que de `date`,
    connue avant même que le Planificateur ne tourne — les deux démarrent
    donc en parallèle ici. L'orchestrateur réattend le même Task après cet
    appel pour obtenir planner_output — un Task le permet, une coroutine nue
    ne le permettrait pas (awaitable une seule fois en Python).
    """
    context_coro = gather_analyst_context(date, blackboard)
    planner_output, context = await asyncio.gather(planner_task, context_coro)
    analyst_output = await reason_analyst_picks(planner_output, context, None, blackboard, budget)

    blackboard.post(
        from_role="analyst",
        to_role="odds-selector",
        type="decision",
        content=f"{len(analyst_output['picks_retenus'])} picks candidats — {analyst_output['summary']}",
    )

    if not analyst_output["picks_retenus"]:
        return {"analyst_output": analyst_output, "odds_selector_output": None}

    odds_selector_output = await decide_odds(analyst_output["picks_retenus"], blackboard)
    return {"analyst_output": analyst_output, "odds_selector_output": odds_selector_output}
