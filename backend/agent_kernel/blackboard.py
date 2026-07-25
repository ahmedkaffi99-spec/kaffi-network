"""Port de lib/agent-kernel/blackboard.ts.

Mémoire court terme partagée d'un run : un tableau noir que chaque agent lit
et enrichit. C'est le canal de communication inter-agents — chaque agent y
publie ses observations/décisions au lieu de s'adresser directement à un
autre agent, ce qui rend l'échange traçable et rejouable (dashboard, debug,
mémoire court terme persistée en fin de run).
"""
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from .types import AgentRole, BlackboardMessage, BlackboardMessageType


class Blackboard:
    # on_message est optionnel — câblé par l'orchestrateur pour persister
    # chaque message en direct (vue "live" du dashboard), sans que ce module
    # générique ne connaisse Supabase. Le kernel reste utilisable sans ce
    # callback.
    def __init__(self, run_id: str, on_message: Callable[[BlackboardMessage], None] | None = None):
        self.run_id = run_id
        self._state: dict[str, Any] = {}
        self._messages: list[BlackboardMessage] = []
        self._model_calls = 0
        self._on_message = on_message

    def write(self, key: str, value: Any) -> None:
        self._state[key] = value

    def read(self, key: str) -> Any | None:
        return self._state.get(key)

    def post(
        self,
        from_role: AgentRole,
        type: BlackboardMessageType,
        content: str,
        to_role: AgentRole | str | None = None,
    ) -> None:
        msg = BlackboardMessage(
            from_role=from_role,
            to_role=to_role,
            type=type,
            content=content,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._messages.append(msg)
        if self._on_message:
            self._on_message(msg)

    def get_messages(
        self, from_role: AgentRole | None = None, type: BlackboardMessageType | None = None
    ) -> list[BlackboardMessage]:
        return [
            m
            for m in self._messages
            if (from_role is None or m.from_role == from_role) and (type is None or m.type == type)
        ]

    def render_recent(self, limit: int = 8) -> str:
        """Rendu texte des derniers messages — utilisé comme mémoire court terme dans les prompts."""
        recent = self._messages[-limit:]
        if not recent:
            return "Aucun échange pour le moment."
        return "\n".join(f"[{m.from_role} → {m.to_role or 'crew'}] ({m.type}) {m.content}" for m in recent)

    def record_model_call(self) -> None:
        self._model_calls += 1

    @property
    def model_call_count(self) -> int:
        return self._model_calls

    def transcript(self) -> list[BlackboardMessage]:
        return list(self._messages)
