import sharp from 'sharp'

// Logos réels fournis par API-Football (media.api-sports.io) — récupérés à
// la génération du ticket, jamais mis en cache sur disque (URL dynamique
// par équipe). Repli silencieux sur le drapeau/les initiales (voir
// image-generator.ts) si le fetch échoue ou dépasse le délai — un logo
// indisponible ne doit jamais bloquer la génération du ticket.
const FETCH_TIMEOUT_MS = 4000

const cache = new Map<string, Promise<string | null>>()

async function fetchAndNormalize(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) return null

    const buffer = Buffer.from(await res.arrayBuffer())
    const png = await sharp(buffer).resize(28, 28, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

export function loadTeamLogoDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  if (!cache.has(url)) cache.set(url, fetchAndNormalize(url))
  return cache.get(url)!
}
