"""Port de lib/agent-kernel/mission.ts.

Rend le bloc "mission" d'un agent — responsabilité unique + bornes
explicites — de façon uniforme, injecté en tête de chaque system prompt.
"""
from .types import AgentMission


def render_mission(mission: AgentMission) -> str:
    bounds = "\n".join(f"- {d}" for d in mission.does_not)
    return f"""Tu es {mission.label} (rôle: {mission.role}).
Ta SEULE responsabilité : {mission.responsibility}

Ce qui N'EST PAS de ta responsabilité (délégué à un autre agent du crew) :
{bounds}"""
