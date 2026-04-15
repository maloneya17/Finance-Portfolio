import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/app-shell'
import { ErrorBoundary } from '@/components/error-boundary'
import { OnboardingModal } from '@/components/onboarding/onboarding-modal'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Fetch profile + settings in parallel
  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  return (
    <AppShell user={user} profile={profile} settings={settings}>
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
      {!settings && <OnboardingModal userId={user.id} />}
    </AppShell>
  )
}
