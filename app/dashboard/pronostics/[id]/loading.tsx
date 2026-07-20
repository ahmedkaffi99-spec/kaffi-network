import { Header } from '@/components/Header'
import { Skeleton } from '@/components/Skeleton'

export default function SessionDetailLoading() {
  return (
    <div>
      <Header title="Session" subtitle="Chargement…" />
      <div className="p-4 sm:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-32 rounded-full" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-navy-800/60 border border-navy-700/50 rounded-2xl p-5 space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
