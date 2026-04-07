import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TransactionsView } from '@/components/transactions/transactions-view'
import { getMonthKey } from '@/lib/utils'

export const metadata = { title: 'Transactions — Infinity Finance' }

export default async function TransactionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const yearStart = `${new Date().getFullYear()}-01-01`

  const [{ data: transactions }, { data: settings }] = await Promise.all([
    supabase.from('transactions').select('*').eq('user_id', user.id).gte('date', yearStart).order('date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  return (
    <TransactionsView
      transactions={transactions ?? []}
      settings={settings}
      userId={user.id}
    />
  )
}
