import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/server-data'
import { InsightsView } from '@/components/insights/insights-view'
import type { Transaction, Settings } from '@/types/supabase'

export const metadata = { title: 'Insights — Infinity Finance' }

export default async function InsightsPage() {
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
  if (dateFilter) query = query.gte('date', dateFilter)
  const { data: transactions } = await query.order('date', { ascending: false }).limit(500)

  return (
    <InsightsView
      isPro={isPro}
      transactions={(transactions ?? []) as Transaction[]}
      settings={settings as Settings | null}
    />
  )
}
