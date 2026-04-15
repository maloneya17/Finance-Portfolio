import { TransactionSkeleton } from '@/components/ui/skeleton-list'
import { Skeleton } from '@/components/ui/skeleton'

export default function TransactionsLoading() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex justify-between">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
      </div>
      <TransactionSkeleton />
    </div>
  )
}
