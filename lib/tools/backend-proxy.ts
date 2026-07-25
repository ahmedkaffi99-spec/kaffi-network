/**
 * Relaie une requête déjà authentifiée (Supabase Auth, vérifié par
 * l'appelant) vers le backend Python local (backend/app.py). Le header
 * X-Local-Secret n'est PAS de l'authentification utilisateur — c'est un
 * filtre réseau local qui empêche un autre appareil du même réseau
 * d'appeler directement le backend Python en contournant Next.js (voir
 * backend/local_auth.py).
 */
const BACKEND_URL = process.env.PYTHON_BACKEND_URL ?? 'http://127.0.0.1:8000'

export async function proxyToBackend(path: string, init?: RequestInit): Promise<Response> {
  const secret = process.env.LOCAL_BACKEND_SECRET
  if (!secret) throw new Error('LOCAL_BACKEND_SECRET manquant côté frontend (.env.local)')

  return fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'X-Local-Secret': secret },
    // Le backend local peut prendre plusieurs minutes (pipeline complet) —
    // pas de cache Next.js sur ces appels serveur-à-serveur.
    cache: 'no-store',
  })
}
