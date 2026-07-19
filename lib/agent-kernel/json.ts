/**
 * Extraction et parsing JSON tolérants aux réponses LLM mal formées —
 * TOUJOURS fail-closed : en cas d'échec, retourne le fallback fourni par
 * l'appelant plutôt qu'une valeur par défaut optimiste. C'est cette règle
 * qui a été violée dans le superviseur (une réponse illisible validait les
 * picks par défaut) ; elle est maintenant centralisée ici pour ne plus
 * pouvoir régresser silencieusement dans un agent.
 */

/** Isole le bloc JSON d'une réponse LLM (fence ```json, ou accolades équilibrées). */
export function extractJsonBlock(text: string): string {
  const fenceMatch = text.match(/```json?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()

  const braceStart = text.indexOf('{')
  if (braceStart === -1) return text.trim()

  let depth = 0
  let inString = false
  let escape = false
  let end = -1

  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
  }

  if (end !== -1) return text.slice(braceStart, end + 1)

  // JSON tronqué (ex: coupé par maxOutputTokens) — tente de le refermer.
  const partial = text.slice(braceStart)
  const opens = (partial.match(/\{/g) ?? []).length
  const closes = (partial.match(/\}/g) ?? []).length
  return partial + '}'.repeat(Math.max(0, opens - closes))
}

/** Parse en JSON ; retourne `fallback` (fail-closed) si invalide — ne lève jamais. */
export function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** Combine extraction + parsing fail-closed en un seul appel. */
export function parseAgentJSON<T>(rawText: string, fallback: T): T {
  return safeParseJSON(extractJsonBlock(rawText), fallback)
}
