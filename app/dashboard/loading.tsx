import { Header } from '@/components/Header'
import { Skeleton, SkeletonStatsGrid, SkeletonSessionCard } from '@/components/Skeleton'

export default function DashboardLoading() {
  return (
    <div>
      <Header title="Vue d'ensemble" subtitle="Pipeline de pronostics · IA de Pronostics & Coupons" />
      <div className="p-4 sm:p-8 space-y-6">
        <SkeletonStatsGrid />
        <SkeletonStatsGrid />
        <div className="space-y-4">
          <Skeleton className="h-4 w-40" />
          <SkeletonSessionCard />
          <SkeletonSessionCard />
        </div>
      </div>
    </div>
  )
}
