const SERPER_API = 'https://google.serper.dev/news'

export interface SerperResult {
  title: string
  snippet: string
  link: string
  date?: string
  source?: string
}

export async function searchNews(query: string, num = 5): Promise<SerperResult[]> {
  const res = await fetch(SERPER_API, {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num, gl: 'fr', hl: 'fr' }),
  })

  if (!res.ok) {
    console.warn(`Serper API ${res.status} for "${query}" — skipping news context`)
    return []
  }

  const data = await res.json()
  return (data.news ?? []).slice(0, num).map((item: Record<string, string>) => ({
    title: item.title,
    snippet: item.snippet,
    link: item.link,
    date: item.date,
    source: item.source,
  }))
}

// Vérifie les actualités pouvant invalider une tendance (blessures, suspensions)
export async function checkTeamNews(teamName: string): Promise<string> {
  const results = await searchNews(`${teamName} blessure suspension forfait`, 3)
  if (results.length === 0) return 'Aucune actualité notable détectée.'

  return results
    .map(r => `[${r.source ?? 'Source'}] ${r.title}: ${r.snippet}`)
    .join(' | ')
}

// Découverte AVANT toute analyse chiffrée — identifie les matchs dont on
// parle réellement aujourd'hui (calendrier, affiches marquantes), pour que
// le Planificateur ancre son plan sur du réel plutôt que sur sa seule
// connaissance générale. Plusieurs requêtes complémentaires, dédupliquées
// par lien, plafonnées à 15 résultats.
export async function searchTrendingMatches(dateLabel: string): Promise<SerperResult[]> {
  const queries = [
    `programme matchs football ${dateLabel}`,
    `pronostics foot du jour meilleurs matchs ${dateLabel}`,
  ]

  const batches = await Promise.all(queries.map(q => searchNews(q, 10)))
  const seen = new Set<string>()
  const merged: SerperResult[] = []

  for (const batch of batches) {
    for (const result of batch) {
      if (seen.has(result.link)) continue
      seen.add(result.link)
      merged.push(result)
      if (merged.length >= 15) return merged
    }
  }

  return merged
}
