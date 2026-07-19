import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * Autorise soit `Authorization: Bearer <secret>` soit `?secret=<secret>` en
 * query string — certains services de cron externes (cron-job.org et
 * équivalents) n'exposent pas toujours des en-têtes personnalisés selon le
 * plan/l'interface, la query string reste toujours disponible.
 */
export function isAuthorizedCronRequest(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const headerSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  const querySecret = req.nextUrl.searchParams.get('secret')
  const provided = headerSecret || querySecret
  if (!provided) return false

  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)
  if (providedBuf.length !== expectedBuf.length) return false

  return timingSafeEqual(providedBuf, expectedBuf)
}
