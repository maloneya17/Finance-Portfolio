import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  // 1. Verify the requesting user is authenticated via the session client (cookie-based)
  const sessionClient = await createSessionClient()
  const { data: { user }, error: authError } = await sessionClient.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1b. Rate-limit account deletion to 3 attempts per 5 minutes
  if (!await rateLimit(`account-delete:${user.id}`, 3, 300_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  // 2. Require password confirmation to prevent CSRF
  const body = await request.json() as { password?: string }
  const { password } = body
  if (!password) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  }
  if (password.length > 1024) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // 3. Re-authenticate to confirm the request is intentional
  if (!user.email) {
    return NextResponse.json({ error: 'Account has no email — cannot re-authenticate' }, { status: 400 })
  }
  const { error: reAuthError } = await sessionClient.auth.signInWithPassword({
    email: user.email,
    password,
  })
  if (reAuthError) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 403 })
  }

  const userId = user.id

  // 2. Create service role client to bypass RLS for deletion
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    logger.error('account-delete', 'Missing Supabase service-role env vars')
    return NextResponse.json({ error: 'Service configuration error' }, { status: 500 })
  }

  const serviceClient = createClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const { error: rpcError } = await serviceClient.rpc('delete_account', {
      p_user_id: userId,
    })
    if (rpcError) {
      logger.error('account-delete', 'delete_account RPC failed', { error: rpcError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(userId)
    if (deleteUserError) {
      logger.error('account-delete', 'Auth user deletion failed', { error: deleteUserError.message })
      throw new Error('Account deletion failed at auth cleanup step')
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error('account-delete', 'Account deletion failed', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Account deletion failed. Please contact support.' }, { status: 500 })
  }
}
