"""Agent Kernel — types génériques du framework multi-agents.
Port de lib/agent-kernel/types.ts. Un "crew" (ex: le pipeline pronostics
foot) instancie ces primitives ; le kernel lui-même ne connaît rien du
domaine métier.
"""
from dataclasses import dataclass, field
from typing import Literal

AgentRole = str

BlackboardMessageType = Literal["observation", "plan", "decision", "reflection", "action", "result"]


@dataclass
class AgentMission:
    role: AgentRole
    label: str
    # Une seule phrase : la responsabilité unique de l'agent.
    responsibility: str
    # Bornes explicites — ce que l'agent NE fait PAS (délégué à un autre agent).
    does_not: list[str] = field(default_factory=list)


@dataclass
class BlackboardMessage:
    from_role: AgentRole
    type: BlackboardMessageType
    content: str
    created_at: str
    to_role: AgentRole | Literal["all"] | None = None


@dataclass
class RunBudget:
    # Nombre max d'itérations de la boucle de révision.
    max_iterations: int
    # Nombre max d'appels modèle (route_completion) sur tout le run.
    max_model_calls: int
    # Budget de temps total en secondes, mesuré depuis started_at.
    deadline_seconds: float
    started_at: float


@dataclass
class MemoryTiers:
    # Court terme : contexte déjà rendu (résumé des messages du run en cours).
    short_term: str
    # Moyen terme : fenêtre glissante en lecture seule (performance récente).
    medium_term: str
    # Long terme : leçons distillées persistées entre les runs.
    long_term: str
