import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/server-data'
import { TransactionsView } from '@/components/transactions/transactions-view'

export const metadata = { title: 'Transactions — Infinity Finance' }

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { userId, isPro, dateFilter } = await requireAuth()
  const supabase = await createClient()
  const params = await searchParams
  const initialCategory = typeof params.category === 'string' ? params.category : null

  let txQuery = supabase.from('transactions').select('*').eq('user_id', userId).is('deleted_at', null).order('date', { ascending: false }).order('created_at', { ascending: false })
  if (dateFilter) txQuery = txQuery.gte('date', dateFilter)

  const [{ data: transactions }, { data: settings }] = await Promise.all([
    // TODO: implement cursor-based pagination when > 500 transactions
    txQuery.limit(500),
    supabase.from('settings').select('*').eq('user_id', userId).single(),
  ])

  return (
    <TransactionsView
      transactions={transactions ?? []}
      settings={settings}
      userId={userId}
      isPro={isPro}
      hitLimit={transactions?.length === 500}
      initialCategory={initialCategory}
    />
  )
}
