import { Header } from '@/components/Header'
import { Skeleton } from '@/components/Skeleton'

export default function ChatLoading() {
  return (
    <div>
      <Header title="Chat" subtitle="Discute avec l'Analyste ou le Rédacteur de n'importe quel combiné" />
      <div className="p-4 sm:p-8">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="w-full lg:w-72 flex-shrink-0 space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
          <Skeleton className="flex-1 h-96 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
