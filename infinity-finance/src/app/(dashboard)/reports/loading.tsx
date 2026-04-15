import { CardSkeleton } from '@/components/ui/skeleton-list'

export default function ReportsLoading() {
  return (
    <div className="space-y-4 p-6">
      {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
    </div>
  )
}
