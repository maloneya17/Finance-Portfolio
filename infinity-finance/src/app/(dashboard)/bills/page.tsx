import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/server-data'
import { BillsView } from '@/components/bills/bills-view'
import { getMonthKey } from '@/lib/utils'

export const metadata = { title: 'Bills — Infinity Finance' }

export default async function BillsPage() {
  const { userId } = await requireAuth()
  const supabase = await createClient()

  const monthKey = getMonthKey()
  const [{ data: bills }, { data: payments }, { data: settings }] = await Promise.all([
    supabase.from('bills').select('*').eq('user_id', userId).eq('is_active', true).order('day'),
    supabase.from('bill_payments').select('*').eq('user_id', userId).eq('month_key', monthKey),
    supabase.from('settings').select('*').eq('user_id', userId).single(),
  ])

  return (
    <BillsView
      bills={(bills ?? []) as import('@/types/supabase').Bill[]}
      initialPayments={(payments ?? []) as import('@/types/supabase').BillPayment[]}
      settings={settings as import('@/types/supabase').Settings | null}
      userId={userId}
      currentMonth={monthKey}
    />
  )
}
