"""Port de lib/tools/quota-tracker.ts.

Réutilise la RPC Supabase increment_api_quota déjà en place — aucune
migration SQL nécessaire.
"""
from datetime import datetime, timezone

from supabase_client import admin_supabase

DEFAULT_PROVIDER = "api-football"
DAILY_LIMIT = 100


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def get_quota_used(provider: str = DEFAULT_PROVIDER) -> int:
    res = (
        admin_supabase.table("api_quota")
        .select("calls_used")
        .eq("date", _today_utc())
        .eq("provider", provider)
        .maybe_single()
        .execute()
    )
    return (res.data or {}).get("calls_used", 0)


def increment_quota(provider: str = DEFAULT_PROVIDER, n: int = 1) -> int:
    res = admin_supabase.rpc(
        "increment_api_quota", {"p_date": _today_utc(), "p_provider": provider, "p_n": n}
    ).execute()
    return res.data


def get_remaining_quota(provider: str = DEFAULT_PROVIDER) -> int:
    used = get_quota_used(provider)
    return max(0, DAILY_LIMIT - used)
