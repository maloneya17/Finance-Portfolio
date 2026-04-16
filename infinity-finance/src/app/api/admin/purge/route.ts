import { NextResponse } from 'next/server'
import { timingSafeEqual, createHash } from 'crypto'
import { rateLimit } from '@/lib/rate-limit'

function safeCompare(a: string, b: string): boolean {
  // Normalise to same length to prevent length-based timing leaks
  const bufA = Buffer.from(createHash('sha256').update(a).digest())
  const bufB = Buffer.from(createHash('sha256').update(b).digest())
  return timingSafeEqual(bufA, bufB)
}

// Called by Supabase cron or external scheduler
// Protected by a shared secret
export async function POST(req: Request) {
  // Fail fast if the secret is not configured — an empty secret would match
  // any request that sends "Authorization: Bearer " (trailing space), bypassing auth.
  if (!process.env.PURGE_SECRET) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  if (!rateLimit('purge', 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const authHeader = req.headers.get('authorization')
  const provided = authHeader ?? ''
  const expected = `Bearer ${process.env.PURGE_SECRET}`
  if (!safeCompare(provided, expected)) {
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
    return NextResponse.json({ error: 'Purge failed' }, { status: 500 })
  }

  return NextResponse.json({ purged: count })
}
