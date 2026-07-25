"""Port de lib/tools/result-checker.ts."""
import re
from datetime import datetime, timedelta, timezone

from supabase_client import admin_supabase
from tools.football_api import get_match_result
from tools.memory import update_performance
from tools.telegram import format_result_announcement, send_message


def _evaluate_result(bet_type: str, home_team: str, away_team: str, home_goals: int, away_goals: int) -> str:
    total = home_goals + away_goals
    bt = bet_type.lower()

    if "moins de 1.5" in bt or "under 1.5" in bt:
        return "win" if total < 1.5 else "loss"
    if "plus de 1.5" in bt or "over 1.5" in bt:
        return "win" if total > 1.5 else "loss"
    if "moins de 2.5" in bt or "under 2.5" in bt:
        return "win" if total < 2.5 else "loss"
    if "plus de 2.5" in bt or "over 2.5" in bt:
        return "win" if total > 2.5 else "loss"
    if "moins de 3.5" in bt or "under 3.5" in bt:
        return "win" if total < 3.5 else "loss"
    if "plus de 3.5" in bt or "over 3.5" in bt:
        return "win" if total > 3.5 else "loss"

    if "btts oui" in bt or "les deux équipes marquent" in bt:
        return "win" if home_goals > 0 and away_goals > 0 else "loss"
    if "btts non" in bt:
        return "win" if home_goals == 0 or away_goals == 0 else "loss"

    if "handicap" in bt:
        point_match = re.search(r"[+-]?\d+(?:\.\d+)?", bet_type)
        if not point_match:
            return "void"
        point = float(point_match.group(0))
        is_home_team = home_team.lower() in bt
        is_away_team = away_team.lower() in bt
        if not is_home_team and not is_away_team:
            return "void"
        adjusted = (home_goals + point - away_goals) if is_home_team else (away_goals + point - home_goals)
        if adjusted > 0:
            return "win"
        if adjusted < 0:
            return "loss"
        return "void"  # push — ligne entière (ex: -1, -2) tombant pile sur le score ajusté

    if "victoire" in bt and "domicile" in bt:
        return "win" if home_goals > away_goals else "loss"
    if "victoire" in bt and "extérieur" in bt:
        return "win" if away_goals > home_goals else "loss"
    if "nul" in bt or "draw" in bt:
        return "win" if home_goals == away_goals else "loss"

    # Victoire [nom équipe] — domicile si nommée, sinon void
    if bt.startswith("victoire "):
        team_name = bt.replace("victoire ", "", 1).strip()
        if team_name and home_goals > away_goals:
            return "win"
        if team_name and away_goals > home_goals:
            return "loss"

    return "void"


async def check_pending_results() -> dict:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()

    res = (
        admin_supabase.table("picks")
        .select("id, session_id, home_team, away_team, competition, match_datetime, bet_type, odds, result")
        .is_("result", "null")
        .eq("was_rejected", False)
        .lt("match_datetime", cutoff)
        .limit(50)
        .execute()
    )
    pending = res.data or []
    if not pending:
        return {"checked": 0, "updated": 0}

    updated = 0

    for pick in pending:
        match_date = pick["match_datetime"].split("T")[0]
        score = await get_match_result(pick["home_team"], pick["away_team"], match_date)
        if not score:
            continue

        result = _evaluate_result(pick["bet_type"], pick["home_team"], pick["away_team"], score["home"], score["away"])

        admin_supabase.table("picks").update(
            {"result": result, "result_checked_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", pick["id"]).execute()

        # Utilise la compétition directement depuis le pick (plus besoin de requête supplémentaire)
        competition = pick.get("competition") or "Unknown"
        update_performance(pick["bet_type"], competition, result, pick["odds"])
        updated += 1

    return {"checked": len(pending), "updated": updated}


async def announce_session_results() -> dict:
    """Poste le résultat d'un combiné sur Telegram une fois que TOUS ses picks
    sont résolus (win/loss/void) — un seul pick perdant fait perdre tout le
    combiné, comme un vrai pari combiné. Chaque session n'est annoncée
    qu'une fois (result_posted_at). Appelé après check_pending_results()
    dans le même run planifié, pour que les picks soient déjà à jour."""
    res = (
        admin_supabase.table("pronostic_sessions")
        .select("id, tier, date, combined_odds, telegram_msg_id, picks(result, was_rejected)")
        .eq("status", "published")
        .is_("result_posted_at", "null")
        .limit(20)
        .execute()
    )
    sessions = res.data or []
    if not sessions:
        return {"checked": 0, "announced": 0}

    announced = 0

    for session in sessions:
        picks = [p for p in (session.get("picks") or []) if not p.get("was_rejected")]
        if not picks:
            continue

        all_resolved = all(p.get("result") is not None for p in picks)
        if not all_resolved:
            continue

        has_loss = any(p["result"] == "loss" for p in picks)
        all_void = all(p["result"] == "void" for p in picks)
        combo_result = "loss" if has_loss else "void" if all_void else "win"
        wins = sum(1 for p in picks if p["result"] == "win")

        message = format_result_announcement(
            session["tier"], session["date"], combo_result, wins, len(picks), session.get("combined_odds")
        )

        await send_message(message, session.get("telegram_msg_id"))

        admin_supabase.table("pronostic_sessions").update(
            {"combo_result": combo_result, "result_posted_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", session["id"]).execute()

        announced += 1

    return {"checked": len(sessions), "announced": announced}
