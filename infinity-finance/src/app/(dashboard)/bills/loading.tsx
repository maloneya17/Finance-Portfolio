import { TableSkeleton } from '@/components/ui/skeleton-list'

export default function BillsLoading() {
  return <div className="p-6"><TableSkeleton rows={6} /></div>
}
