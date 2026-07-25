import { proxyToBackend } from '@/lib/tools/backend-proxy'

// Logo statique de la chaîne (dashboard/prévisualisation) — relayé vers
// backend/routers/channel_logo.py (Pillow, remplace Satori+Sharp).
export async function GET() {
  const res = await proxyToBackend('/api/channel-logo')
  const buf = await res.arrayBuffer()

  return new Response(buf, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'image/png',
      'Content-Disposition': res.headers.get('Content-Disposition') ?? 'attachment; filename="logo.png"',
    },
  })
}
