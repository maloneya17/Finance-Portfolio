import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Called by Supabase cron or external scheduler
// Protected by a shared secret
export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.PURGE_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Use service role to bypass RLS
  const { createClient: createAdminClient } = await import('@supabase/supabase-js')
  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { error, count } = await supabase
    .from('transactions')
    .delete({ count: 'exact' })
    .not('deleted_at', 'is', null)
    .lt('deleted_at', ninetyDaysAgo)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ purged: count })
}
