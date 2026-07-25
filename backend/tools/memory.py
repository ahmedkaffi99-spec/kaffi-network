"""Port de lib/tools/memory.ts — mémoire moyen terme (bet_performance)."""
from datetime import datetime, timezone

from supabase_client import admin_supabase


def get_bet_performance(bet_type: str, competition: str) -> dict | None:
    res = (
        admin_supabase.table("bet_performance")
        .select("*")
        .eq("bet_type", bet_type)
        .eq("competition", competition)
        .maybe_single()
        .execute()
    )
    return res.data


def get_all_performance() -> list[dict]:
    res = (
        admin_supabase.table("bet_performance")
        .select("*")
        .order("last_updated", desc=True)
        .execute()
    )
    return res.data or []


def update_performance(bet_type: str, competition: str, result: str, odds: float) -> None:
    existing = get_bet_performance(bet_type, competition)
    now = datetime.now(timezone.utc).isoformat()

    if not existing:
        admin_supabase.table("bet_performance").insert(
            {
                "bet_type": bet_type,
                "competition": competition,
                "total_picks": 1,
                "wins": 1 if result == "win" else 0,
                "losses": 1 if result == "loss" else 0,
                "voids": 1 if result == "void" else 0,
                "avg_odds": odds,
                "last_updated": now,
            }
        ).execute()
        return

    new_total = existing["total_picks"] + 1
    new_avg_odds = (
        round(((existing["avg_odds"] * existing["total_picks"] + odds) / new_total) * 100) / 100
        if existing.get("avg_odds")
        else odds
    )

    admin_supabase.table("bet_performance").update(
        {
            "total_picks": new_total,
            "wins": existing["wins"] + (1 if result == "win" else 0),
            "losses": existing["losses"] + (1 if result == "loss" else 0),
            "voids": existing["voids"] + (1 if result == "void" else 0),
            "avg_odds": new_avg_odds,
            "last_updated": now,
        }
    ).eq("bet_type", bet_type).eq("competition", competition).execute()


def format_memory_context(performance: list[dict]) -> str:
    """Formate la mémoire en contexte lisible par l'analyste."""
    if not performance:
        return "Aucun historique de performance disponible."

    eligible = [p for p in performance if p["total_picks"] >= 3]
    eligible.sort(key=lambda p: (p["wins"] / p["total_picks"]) if p["total_picks"] > 0 else 0, reverse=True)

    lines = []
    for p in eligible[:15]:
        wr = round((p["wins"] / p["total_picks"]) * 100) if p["total_picks"] > 0 else 0
        lines.append(f"{p['bet_type']} ({p['competition']}): {wr}% succès sur {p['total_picks']} picks")

    return "\n".join(lines)
