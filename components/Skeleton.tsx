interface SkeletonProps {
  className?: string
}

// Bloc de chargement générique — utilisé par les loading.tsx par route
// (Next.js App Router streaming) pour donner un retour visuel instantané à
// la navigation au lieu d'un écran figé pendant l'attente des données.
export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse bg-navy-700/40 rounded-lg ${className}`} />
}

export function SkeletonStatsGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl p-5 border border-navy-700/50 bg-navy-800/60">
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-8 w-16 mb-2" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonSessionCard() {
  return (
    <div className="bg-navy-800/60 border border-navy-700/50 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <Skeleton className="h-3 w-28 mb-2" />
          <Skeleton className="h-6 w-32" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className="h-4 w-40" />
    </div>
  )
}
