import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InsightsView } from '@/components/insights/insights-view'
import type { Transaction, Settings, Profile } from '@/types/supabase'

export const metadata = { title: 'Insights — Infinity Finance' }

export default async function InsightsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: transactions }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('transactions').select('*').eq('user_id', user.id).gte('date', `${new Date().getFullYear() - 1}-01-01`).order('date'),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  return (
    <InsightsView
      profile={profile as Profile | null}
      transactions={(transactions ?? []) as Transaction[]}
      settings={settings as Settings | null}
    />
  )
}
