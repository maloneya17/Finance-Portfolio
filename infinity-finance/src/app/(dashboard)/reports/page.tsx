import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/server-data'
import { ReportsView } from '@/components/reports/reports-view'
import type { Transaction, Settings } from '@/types/supabase'

export const metadata = { title: 'Reports — Infinity Finance' }

export default async function ReportsPage() {
  const { userId, isPro, dateFilter } = await requireAuth()
  const supabase = await createClient()

  const { data: settings } = await supabase.from('settings').select('*').eq('user_id', userId).single()

  // Build query dynamically: free users are limited to last 3 months
  let query = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .neq('type', 'transfer')
  if (dateFilter) {
    query = query.gte('date', dateFilter)
  }
  // TODO: implement cursor-based pagination when > 500 transactions
  const { data: transactions } = await query.order('date', { ascending: false }).limit(500)

  return (
    <ReportsView
      isPro={isPro}
      transactions={(transactions ?? []) as Transaction[]}
      settings={settings as Settings | null}
    />
  )
}
