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

  const isPro = (profile as { subscription: string } | null)?.subscription === 'pro'

  let dateFilter: string
  if (isPro) {
    dateFilter = `${new Date().getFullYear()}-01-01`
  } else {
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    dateFilter = threeMonthsAgo.toISOString().slice(0, 10)
  }

  const [{ data: transactions }, { data: settings }] = await Promise.all([
    supabase.from('transactions').select('*').eq('user_id', user.id).gte('date', dateFilter).order('date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  return (
    <TransactionsView
      transactions={transactions ?? []}
      settings={settings}
      userId={user.id}
      isPro={isPro}
    />
  )
}
