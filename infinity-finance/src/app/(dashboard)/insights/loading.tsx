import { CardSkeleton } from '@/components/ui/skeleton-list'

export default function InsightsLoading() {
  return (
    <div className="space-y-4 p-6">
      {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
    </div>
  )
}
