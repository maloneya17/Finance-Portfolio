import { CardSkeleton } from '@/components/ui/skeleton-list'

export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  )
}
