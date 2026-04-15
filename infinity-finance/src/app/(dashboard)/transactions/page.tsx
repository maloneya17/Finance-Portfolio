import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TransactionsView } from '@/components/transactions/transactions-view'

export const metadata = { title: 'Transactions — Infinity Finance' }

export default async function TransactionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription')
    .eq('id', user.id)
    .single()

  // Subscription tier verified server-side — cannot be overridden by client
  // Re-derive the date filter server-side, never trust client state
  const subscription = (profile as { subscription: string } | null)?.subscription ?? 'free'
  const isPro = subscription === 'pro'

  let dateFilter: string
  if (isPro) {
    dateFilter = `${new Date().getFullYear()}-01-01`
  } else {
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    dateFilter = threeMonthsAgo.toISOString().slice(0, 10)
  }

  const [{ data: transactions }, { data: settings }] = await Promise.all([
    // TODO: implement cursor-based pagination when > 500 transactions
    supabase.from('transactions').select('*').eq('user_id', user.id).gte('date', dateFilter).is('deleted_at', null).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  return (
    <TransactionsView
      transactions={transactions ?? []}
      settings={settings}
      userId={user.id}
      isPro={isPro}
      hitLimit={transactions?.length === 500}
    />
  )
}
