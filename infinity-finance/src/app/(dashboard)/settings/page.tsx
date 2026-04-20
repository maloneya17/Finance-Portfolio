import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/server-data'
import { SettingsView } from '@/components/settings/settings-view'
import type { Profile, Settings, Budget } from '@/types/supabase'

export const metadata = { title: 'Settings — Infinity Finance' }

export default async function SettingsPage() {
  const { userId } = await requireAuth()
  const supabase = await createClient()

  const [authResult, { data: profile }, { data: settings }, { data: budgets }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('settings').select('*').eq('user_id', userId).single(),
    supabase.from('budgets').select('*').eq('user_id', userId).order('category'),
  ])

  return (
    <SettingsView
      user={{ id: userId, email: authResult.data.user?.email ?? '' }}
      profile={profile as Profile | null}
      settings={settings as Settings | null}
      initialBudgets={(budgets as Budget[] | null) ?? []}
    />
  )
}
