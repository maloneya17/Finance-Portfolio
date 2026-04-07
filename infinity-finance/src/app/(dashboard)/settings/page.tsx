import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SettingsView } from '@/components/settings/settings-view'
import type { Profile, Settings } from '@/types/supabase'

export const metadata = { title: 'Settings — Infinity Finance' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  return (
    <SettingsView
      user={{ id: user.id, email: user.email ?? '' }}
      profile={profile as Profile | null}
      settings={settings as Settings | null}
    />
  )
}
