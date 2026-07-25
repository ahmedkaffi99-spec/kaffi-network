"""Port de lib/agent-kernel/json.ts (renommé json_utils pour ne pas masquer
le module stdlib `json`).

Extraction et parsing JSON tolérants aux réponses LLM mal formées —
TOUJOURS fail-closed : en cas d'échec, retourne le fallback fourni par
l'appelant plutôt qu'une valeur par défaut optimiste.
"""
import json
import re
from typing import TypeVar

T = TypeVar("T")


def extract_json_block(text: str) -> str:
    """Isole le bloc JSON d'une réponse LLM (fence ```json, ou accolades équilibrées)."""
    fence_match = re.search(r"```json?\s*([\s\S]*?)```", text)
    if fence_match:
        return fence_match.group(1).strip()

    brace_start = text.find("{")
    if brace_start == -1:
        return text.strip()

    depth = 0
    in_string = False
    escape = False
    end = -1

    for i in range(brace_start, len(text)):
        ch = text[i]
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break

    if end != -1:
        return text[brace_start : end + 1]

    # JSON tronqué (ex: coupé par max_tokens) — tente de le refermer.
    partial = text[brace_start:]
    opens = partial.count("{")
    closes = partial.count("}")
    return partial + "}" * max(0, opens - closes)


def safe_parse_json(text: str, fallback: T) -> T:
    """Parse en JSON ; retourne `fallback` (fail-closed) si invalide — ne lève jamais."""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return fallback


def parse_agent_json(raw_text: str, fallback: T) -> T:
    """Combine extraction + parsing fail-closed en un seul appel."""
    return safe_parse_json(extract_json_block(raw_text), fallback)
