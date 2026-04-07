import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BillsView } from '@/components/bills/bills-view'
import { getMonthKey } from '@/lib/utils'

export const metadata = { title: 'Bills — Infinity Finance' }

export default async function BillsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const monthKey = getMonthKey()
  const [{ data: bills }, { data: payments }, { data: settings }] = await Promise.all([
    supabase.from('bills').select('*').eq('user_id', user.id).eq('is_active', true).order('day'),
    supabase.from('bill_payments').select('*').eq('user_id', user.id).eq('month_key', monthKey),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  return (
    <BillsView
      bills={(bills ?? []) as import('@/types/supabase').Bill[]}
      payments={(payments ?? []) as import('@/types/supabase').BillPayment[]}
      settings={settings as import('@/types/supabase').Settings | null}
      userId={user.id}
      currentMonth={monthKey}
    />
  )
}
