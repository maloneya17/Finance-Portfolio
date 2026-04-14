import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InsightsView } from '@/components/insights/insights-view'
import type { Transaction, Settings, Profile } from '@/types/supabase'

export const metadata = { title: 'Insights — Infinity Finance' }

export default async function InsightsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  // Subscription tier verified server-side — cannot be overridden by client
  const isPro = (profile as Profile | null)?.subscription === 'pro'

  // Build query dynamically: free users are limited to last 3 months
  let query = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
  if (!isPro) {
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    query = query.gte('date', threeMonthsAgo.toISOString().split('T')[0])
  }
  // TODO: implement cursor-based pagination when > 500 transactions
  const { data: transactions } = await query.order('date', { ascending: false }).limit(500)

  return (
    <InsightsView
      profile={profile as Profile | null}
      transactions={(transactions ?? []) as Transaction[]}
      settings={settings as Settings | null}
    />
  )
}
