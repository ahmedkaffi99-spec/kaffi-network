import { Header } from '@/components/Header'
import { Skeleton, SkeletonStatsGrid } from '@/components/Skeleton'

export default function StatsLoading() {
  return (
    <div>
      <Header title="Statistiques" subtitle="Performances et historique des résultats" />
      <div className="p-4 sm:p-8 space-y-6">
        <SkeletonStatsGrid />
        <div className="bg-navy-800/60 border border-navy-700/50 rounded-2xl p-5 space-y-3">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </div>
    </div>
  )
}
