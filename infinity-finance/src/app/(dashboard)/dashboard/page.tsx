import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/server-data'
import { DashboardView } from '@/components/dashboard/dashboard-view'
import { getMonthKey } from '@/lib/utils'

export const metadata = { title: 'Dashboard — Infinity Finance' }

export default async function DashboardPage() {
  const { userId, dateFilter } = await requireAuth()
  const supabase = await createClient()

  const now = new Date()
  const monthKey = getMonthKey(now)

  let txQuery = supabase.from('transactions').select('*').eq('user_id', userId).is('deleted_at', null).order('date', { ascending: false })
  if (dateFilter) txQuery = txQuery.gte('date', dateFilter)

  // Fetch all dashboard data in parallel
  const [
    { data: transactions },
    { data: bills },
    { data: billPayments },
    { data: assets },
    { data: debts },
    { data: goals },
    { data: budgets },
    { data: settings },
  ] = await Promise.all([
    // TODO: implement cursor-based pagination when > 500 transactions
    txQuery.limit(500),
    supabase.from('bills').select('*').eq('user_id', userId).eq('is_active', true).order('day'),
    supabase.from('bill_payments').select('*').eq('user_id', userId).eq('month_key', monthKey),
    supabase.from('assets').select('*').eq('user_id', userId).order('value', { ascending: false }),
    supabase.from('debts').select('*').eq('user_id', userId).order('balance', { ascending: false }),
    supabase.from('goals').select('*').eq('user_id', userId).order('created_at'),
    supabase.from('budgets').select('*').eq('user_id', userId),
    supabase.from('settings').select('*').eq('user_id', userId).single(),
  ])

  return (
    <DashboardView
      transactions={transactions ?? []}
      bills={bills ?? []}
      billPayments={billPayments ?? []}
      assets={assets ?? []}
      debts={debts ?? []}
      goals={goals ?? []}
      budgets={budgets ?? []}
      settings={settings}
      currentMonth={monthKey}
    />
  )
}
