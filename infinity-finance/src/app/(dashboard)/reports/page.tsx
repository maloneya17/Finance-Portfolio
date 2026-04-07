import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReportsView } from '@/components/reports/reports-view'
import type { Transaction, Settings } from '@/types/supabase'

export const metadata = { title: 'Reports — Infinity Finance' }

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const yearStart = `${new Date().getFullYear()}-01-01`
  const [{ data: transactions }, { data: settings }] = await Promise.all([
    supabase.from('transactions').select('*').eq('user_id', user.id).gte('date', yearStart).order('date'),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  return (
    <ReportsView
      transactions={(transactions ?? []) as Transaction[]}
      settings={settings as Settings | null}
    />
  )
}
