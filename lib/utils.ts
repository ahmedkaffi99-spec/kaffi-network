export const SPORT_EMOJIS: Record<string, string> = {
  football: '⚽',
}

// Partagé entre la vue live (components/LiveAgentJournal.tsx) et la vue
// historique post-run (app/dashboard/pronostics/[id]/page.tsx) — même
// journal des agents, juste consulté avant ou après la fin du run.
export const MESSAGE_TYPE_STYLES: Record<string, string> = {
  observation: 'text-blue-400',
  plan: 'text-purple-400',
  decision: 'text-gold-400',
  reflection: 'text-amber-400',
  action: 'text-emerald-400',
  result: 'text-gray-400',
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  approved: 'Approuvé',
  rejected: 'Rejeté',
  published: 'Publié',
}

export const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-navy-700 text-gray-300',
  approved: 'bg-emerald-900/50 text-emerald-400 border border-emerald-700/50',
  rejected: 'bg-red-900/50 text-red-400 border border-red-700/50',
  published: 'bg-gold-500/20 text-gold-400 border border-gold-600/50',
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  })
}
