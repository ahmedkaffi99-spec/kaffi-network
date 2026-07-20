import { Header } from '@/components/Header'
import { Skeleton } from '@/components/Skeleton'

export default function RunHistoryLoading() {
  return (
    <div>
      <Header title="Suivi des runs" subtitle="Historique technique des exécutions du pipeline" />
      <div className="p-4 sm:p-8 space-y-3">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    </div>
  )
}
