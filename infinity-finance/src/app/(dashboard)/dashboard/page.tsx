import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DashboardView } from '@/components/dashboard/dashboard-view'
import { getMonthKey } from '@/lib/utils'

export const metadata = { title: 'Dashboard — Infinity Finance' }

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const now = new Date()
  const monthKey = getMonthKey(now)
  const yearStart = `${now.getFullYear()}-01-01`

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
    supabase.from('transactions').select('*').eq('user_id', user.id).gte('date', yearStart).order('date', { ascending: false }),
    supabase.from('bills').select('*').eq('user_id', user.id).eq('is_active', true).order('day'),
    supabase.from('bill_payments').select('*').eq('user_id', user.id).eq('month_key', monthKey),
    supabase.from('assets').select('*').eq('user_id', user.id).order('value', { ascending: false }),
    supabase.from('debts').select('*').eq('user_id', user.id).order('balance', { ascending: false }),
    supabase.from('goals').select('*').eq('user_id', user.id).order('created_at'),
    supabase.from('budgets').select('*').eq('user_id', user.id),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
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
