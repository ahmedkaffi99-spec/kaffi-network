import { Header } from '@/components/Header'
import { Skeleton, SkeletonSessionCard } from '@/components/Skeleton'

export default function PronosticsLoading() {
  return (
    <div>
      <Header title="Pronostics" subtitle="Combinés générés par l'IA — validation et publication" />
      <div className="p-4 sm:p-8">
        <Skeleton className="h-10 w-80 rounded-xl mb-6" />
        <div className="space-y-4">
          <SkeletonSessionCard />
          <SkeletonSessionCard />
          <SkeletonSessionCard />
        </div>
      </div>
    </div>
  )
}
