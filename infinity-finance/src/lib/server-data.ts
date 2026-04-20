import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export interface UserContext {
  userId: string
  isPro: boolean
  dateFilter: string | null  // ISO date string, null = no filter (pro)
}

export async function requireAuth(): Promise<UserContext> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription, subscription_ends_at')
    .eq('id', user.id)
    .single()

  const now = new Date()
  const subscriptionEndsAt = profile?.subscription_ends_at ? new Date(profile.subscription_ends_at) : null
  const isPro = profile?.subscription === 'pro' && (subscriptionEndsAt == null || subscriptionEndsAt > now)

  let dateFilter: string | null = null
  if (!isPro) {
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    dateFilter = threeMonthsAgo.toISOString().split('T')[0]
  }

  return { userId: user.id, isPro, dateFilter }
}
