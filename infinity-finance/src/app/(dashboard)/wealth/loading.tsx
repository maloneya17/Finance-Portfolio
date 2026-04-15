import { CardSkeleton } from '@/components/ui/skeleton-list'

export default function WealthLoading() {
  return (
    <div className="space-y-4 p-6">
      <CardSkeleton />
      <div className="grid md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    </div>
  )
}
