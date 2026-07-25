"""Port de lib/agent-kernel/budget.ts.

Vérifie le budget d'un run et retourne une raison lisible si dépassé, ou
None si on peut continuer. Garde la boucle réflexion → décision bornée et
prévisible (coût, latence) plutôt que de laisser les agents boucler tant
qu'ils "jugent nécessaire".
"""
import time

from .blackboard import Blackboard
from .types import RunBudget


def budget_exceeded(budget: RunBudget, blackboard: Blackboard) -> str | None:
    if blackboard.model_call_count >= budget.max_model_calls:
        return f"budget d'appels modèle atteint ({budget.max_model_calls})"
    if time.time() - budget.started_at >= budget.deadline_seconds:
        return f"deadline dépassée ({round(budget.deadline_seconds)}s)"
    return None


def create_budget(
    max_iterations: int = 3,
    max_model_calls: int = 12,
    deadline_seconds: float = 260.0,
) -> RunBudget:
    return RunBudget(
        max_iterations=max_iterations,
        max_model_calls=max_model_calls,
        deadline_seconds=deadline_seconds,
        started_at=time.time(),
    )
