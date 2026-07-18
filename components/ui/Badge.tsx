import { STATUS_LABELS, STATUS_COLORS } from '@/lib/utils'

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-navy-700 text-gray-300'} ${className}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

interface ResultBadgeProps {
  result: string | null
}

export function ResultBadge({ result }: ResultBadgeProps) {
  if (!result) return <span className="text-xs text-gray-600">En attente</span>

  const colors: Record<string, string> = {
    win: 'bg-emerald-900/50 text-emerald-400 border border-emerald-700/50',
    loss: 'bg-red-900/50 text-red-400 border border-red-700/50',
    void: 'bg-gray-800 text-gray-400 border border-gray-700/50',
  }

  const labels: Record<string, string> = {
    win: '✓ Gagné',
    loss: '✗ Perdu',
    void: '~ Void',
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[result] ?? ''}`}
    >
      {labels[result] ?? result}
    </span>
  )
}
