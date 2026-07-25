"""Port de lib/agent-kernel/memory.ts."""
from datetime import datetime, timezone

from supabase_client import admin_supabase
from tools.memory import format_memory_context, get_all_performance

from .blackboard import Blackboard
from .types import BlackboardMessage


def load_medium_term_digest() -> str:
    performance = get_all_performance()
    return format_memory_context(performance)


def load_long_term_digest(scope: str, limit: int = 12) -> str:
    res = (
        admin_supabase.table("agent_memory_long_term")
        .select("key, value, confidence, updated_at")
        .eq("scope", scope)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return "Aucune leçon long terme enregistrée."

    lines = []
    for r in rows:
        conf = f" (confiance {round(r['confidence'] * 100)}%)" if r.get("confidence") is not None else ""
        lines.append(f"- {r['value']}{conf}")
    return "\n".join(lines)


def persist_long_term_lesson(scope: str, key: str, value: str, confidence: float | None = None) -> None:
    admin_supabase.table("agent_memory_long_term").upsert(
        {
            "scope": scope,
            "key": key,
            "value": value,
            "confidence": confidence,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="scope,key",
    ).execute()


def persist_live_message(scope: str, run_id: str, message: BlackboardMessage) -> None:
    admin_supabase.table("agent_messages").insert(
        {
            "run_id": run_id,
            "scope": scope,
            "session_id": None,
            "from_role": message.from_role,
            "to_role": message.to_role,
            "type": message.type,
            "content": message.content,
            "created_at": message.created_at,
        }
    ).execute()


def persist_run_transcript(scope: str, blackboard: Blackboard, session_id: str | None = None) -> None:
    messages = blackboard.transcript()
    if not messages:
        return

    admin_supabase.table("agent_messages").insert(
        [
            {
                "run_id": blackboard.run_id,
                "scope": scope,
                "session_id": session_id,
                "from_role": m.from_role,
                "to_role": m.to_role,
                "type": m.type,
                "content": m.content,
                "created_at": m.created_at,
            }
            for m in messages
        ]
    ).execute()
