import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/server-data'
import { WealthView } from '@/components/wealth/wealth-view'
import type { Asset, Debt, Goal, Settings } from '@/types/supabase'

export const metadata = { title: 'Wealth — Infinity Finance' }

export default async function WealthPage() {
  const { userId } = await requireAuth()
  const supabase = await createClient()

  const [{ data: assets }, { data: debts }, { data: goals }, { data: settings }] = await Promise.all([
    supabase.from('assets').select('*').eq('user_id', userId).order('value', { ascending: false }),
    supabase.from('debts').select('*').eq('user_id', userId).order('balance', { ascending: false }),
    supabase.from('goals').select('*').eq('user_id', userId).order('created_at'),
    supabase.from('settings').select('*').eq('user_id', userId).single(),
  ])

  return (
    <WealthView
      assets={(assets ?? []) as Asset[]}
      debts={(debts ?? []) as Debt[]}
      goals={(goals ?? []) as Goal[]}
      settings={settings as Settings | null}
      userId={userId}
    />
  )
}
