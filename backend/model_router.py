"""Port de lib/model-router.ts.

OpenRouter (gratuit) comme fournisseur principal, Groq (gratuit, optionnel)
en dernier recours. Aucun coût — uniquement des modèles gratuits, choix
délibéré conservé du site TypeScript.
"""
import asyncio
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.environ["OPENROUTER_API_KEY"]
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
GROQ_BASE = "https://api.groq.com/openai/v1"

# IDs Groq (pas de préfixe fournisseur, contrairement à OpenRouter) — à
# revérifier sur console.groq.com si l'un d'eux échoue systématiquement (le
# routeur passe alors juste au suivant, jamais bloquant).
GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]

# Liste volontairement resserrée à 5 modèles confirmés — mêmes choix que
# lib/model-router.ts, ne pas ajouter de modèle sans qu'on te le demande.
ANALYST_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "poolside/laguna-xs-2.1:free",
    "cohere/north-mini-code:free",
]
PLANNER_MODELS = ANALYST_MODELS
WRITER_MODELS = [
    "tencent/hy3:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "poolside/laguna-xs-2.1:free",
    "cohere/north-mini-code:free",
]


async def _try_model(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    system: str,
    user_message: str,
    max_tokens: int,
    extra_headers: dict[str, str] | None = None,
    retries: int = 1,
) -> str | None:
    for attempt in range(retries + 1):
        try:
            res = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    **(extra_headers or {}),
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_message},
                    ],
                    "max_tokens": max_tokens,
                },
                timeout=45.0,
            )
            if res.status_code == 429 and attempt < retries:
                print(f"[model-router] ⏳ 429 sur {model}, retry dans 20s...")
                await asyncio.sleep(20)
                continue
            res.raise_for_status()
            data = res.json()
            text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            if text and text.strip():
                print(f"[model-router] ✅ {model} — {len(text.strip())} chars")
                return text.strip()
        except httpx.HTTPError as err:
            print(f"[model-router] ❌ {model} — {str(err)[:150]}")
            break
    return None


async def route_completion(
    role: str, system: str, user_message: str, max_tokens: int = 1024
) -> dict[str, str]:
    models = {
        "planner": PLANNER_MODELS,
        "writer": WRITER_MODELS,
    }.get(role, ANALYST_MODELS)

    print(f"[model-router] 🚀 role={role} — essai de {len(models)} modèles OpenRouter")

    async with httpx.AsyncClient() as client:
        for model in models:
            text = await _try_model(
                client,
                OPENROUTER_BASE,
                OPENROUTER_API_KEY,
                model,
                system,
                user_message,
                max_tokens,
                extra_headers={
                    "HTTP-Referer": "http://localhost",
                    "X-Title": "IA de Pronostics & Coupons (local)",
                },
            )
            if text:
                return {"text": text, "model_used": model}

        # Dernier niveau — fournisseur séparé, uniquement si GROQ_API_KEY est
        # configurée. Jamais essayé avant d'avoir épuisé tout OpenRouter.
        if GROQ_API_KEY:
            print(f"[model-router] 🚀 role={role} — essai de {len(GROQ_MODELS)} modèles Groq")
            for model in GROQ_MODELS:
                text = await _try_model(client, GROQ_BASE, GROQ_API_KEY, model, system, user_message, max_tokens)
                if text:
                    return {"text": text, "model_used": f"groq:{model}"}

    print(f"[model-router] ⚠️ tous les modèles ont échoué pour role={role}")
    return {"text": "", "model_used": "unavailable"}
