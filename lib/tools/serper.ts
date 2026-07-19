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
