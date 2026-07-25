"""Port de lib/tools/duplicate-checker.ts."""
from datetime import datetime, timezone

from supabase_client import admin_supabase


def check_duplicates(picks: list[dict], tier: str) -> dict:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    duplicates: list[str] = []

    for pick in picks:
        res = (
            admin_supabase.table("published_matches")
            .select("id")
            .eq("home_team", pick["home_team"])
            .eq("away_team", pick["away_team"])
            .eq("match_date", today)
            .eq("tier", tier)
            .maybe_single()
            .execute()
        )
        if res.data:
            duplicates.append(f"{pick['home_team']} - {pick['away_team']}")

    return {"ok": len(duplicates) == 0, "duplicates": duplicates}


def save_published_matches(picks: list[dict], session_id: str, tier: str) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if not picks:
        return

    admin_supabase.table("published_matches").insert(
        [
            {
                "home_team": p["home_team"],
                "away_team": p["away_team"],
                "match_date": today,
                "session_id": session_id,
                "tier": tier,
            }
            for p in picks
        ]
    ).execute()
