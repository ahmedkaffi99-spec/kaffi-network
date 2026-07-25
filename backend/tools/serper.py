"""Port de lib/tools/serper.ts — Serper.dev (recherche actualités)."""
import os

import httpx

SERPER_API = "https://google.serper.dev/news"


async def search_news(query: str, num: int = 5) -> list[dict]:
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        return []

    async with httpx.AsyncClient() as client:
        res = await client.post(
            SERPER_API,
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json={"q": query, "num": num, "gl": "fr", "hl": "fr"},
            timeout=15.0,
        )
        if not res.is_success:
            print(f'Serper API {res.status_code} for "{query}" — skipping news context')
            return []
        data = res.json()

    return [
        {
            "title": item.get("title"),
            "snippet": item.get("snippet"),
            "link": item.get("link"),
            "date": item.get("date"),
            "source": item.get("source"),
        }
        for item in (data.get("news") or [])[:num]
    ]


async def check_team_news(team_name: str) -> str:
    """Vérifie les actualités pouvant invalider une tendance (blessures, suspensions)."""
    results = await search_news(f"{team_name} blessure suspension forfait", 3)
    if not results:
        return "Aucune actualité notable détectée."
    return " | ".join(f"[{r.get('source') or 'Source'}] {r['title']}: {r['snippet']}" for r in results)


async def search_trending_matches(date_label: str) -> list[dict]:
    """Découverte AVANT toute planification — identifie les matchs dont on
    parle réellement aujourd'hui, plafonnée à 15 résultats dédupliqués par lien."""
    import asyncio

    queries = [
        f"programme matchs football {date_label}",
        f"pronostics foot du jour meilleurs matchs {date_label}",
    ]
    batches = await asyncio.gather(*(search_news(q, 10) for q in queries))

    seen: set[str] = set()
    merged: list[dict] = []
    for batch in batches:
        for result in batch:
            if result["link"] in seen:
                continue
            seen.add(result["link"])
            merged.append(result)
            if len(merged) >= 15:
                return merged

    return merged
