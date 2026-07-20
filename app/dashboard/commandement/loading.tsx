import { Header } from '@/components/Header'
import { Skeleton, SkeletonSessionCard } from '@/components/Skeleton'

export default function CommandCenterLoading() {
  return (
    <div>
      <Header title="Commandement" subtitle="Lance et pilote le pipeline du jour" />
      <div className="p-4 sm:p-8 space-y-6">
        <Skeleton className="h-4 w-40" />
        <SkeletonSessionCard />
        <SkeletonSessionCard />
      </div>
    </div>
  )
}
