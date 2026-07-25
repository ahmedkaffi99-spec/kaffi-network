"""Port de lib/agent-kernel/call.ts.

Enveloppe route_completion() avec la comptabilité de budget du kernel.
Refuse d'appeler le modèle si le budget est déjà épuisé.
"""
from model_router import route_completion

from .blackboard import Blackboard
from .budget import budget_exceeded
from .types import RunBudget


async def call_agent_model(
    role: str,
    system: str,
    user_message: str,
    max_tokens: int,
    blackboard: Blackboard,
    budget: RunBudget,
) -> dict[str, str]:
    exceeded = budget_exceeded(budget, blackboard)
    if exceeded:
        return {"text": "", "model_used": f"skipped ({exceeded})"}

    blackboard.record_model_call()
    return await route_completion(role, system, user_message, max_tokens)
