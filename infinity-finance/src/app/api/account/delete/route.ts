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
  const allowed = rateLimit(`account-delete:${user.id}`, 3, 300_000)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  // 2. Require password confirmation to prevent CSRF
  const body = await request.json() as { password?: string }
  const { password } = body
  if (!password) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 })
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
  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    // 3. Delete data in dependency order to avoid FK violations

    // bill_payments depends on bills — fetch bill IDs first
    const { data: billRows, error: billFetchError } = await serviceClient
      .from('bills')
      .select('id')
      .eq('user_id', userId)
    if (billFetchError) {
      logger.error('account-delete', 'Step failed', { error: billFetchError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    const billIds = (billRows ?? []).map((r: { id: string }) => r.id)
    if (billIds.length > 0) {
      const { error: billPaymentsError } = await serviceClient
        .from('bill_payments')
        .delete()
        .in('bill_id', billIds)
      if (billPaymentsError) {
        logger.error('account-delete', 'Step failed', { error: billPaymentsError.message })
        throw new Error('Account deletion failed at data cleanup step')
      }
    }

    // transactions
    const { error: transactionsError } = await serviceClient
      .from('transactions')
      .delete()
      .eq('user_id', userId)
    if (transactionsError) {
      logger.error('account-delete', 'Step failed', { error: transactionsError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    // bills
    const { error: billsError } = await serviceClient
      .from('bills')
      .delete()
      .eq('user_id', userId)
    if (billsError) {
      logger.error('account-delete', 'Step failed', { error: billsError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    // assets
    const { error: assetsError } = await serviceClient
      .from('assets')
      .delete()
      .eq('user_id', userId)
    if (assetsError) {
      logger.error('account-delete', 'Step failed', { error: assetsError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    // debts
    const { error: debtsError } = await serviceClient
      .from('debts')
      .delete()
      .eq('user_id', userId)
    if (debtsError) {
      logger.error('account-delete', 'Step failed', { error: debtsError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    // goals
    const { error: goalsError } = await serviceClient
      .from('goals')
      .delete()
      .eq('user_id', userId)
    if (goalsError) {
      logger.error('account-delete', 'Step failed', { error: goalsError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    // budgets
    const { error: budgetsError } = await serviceClient
      .from('budgets')
      .delete()
      .eq('user_id', userId)
    if (budgetsError) {
      logger.error('account-delete', 'Step failed', { error: budgetsError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    // wealth_snapshots
    const { error: wealthSnapshotsError } = await serviceClient
      .from('wealth_snapshots')
      .delete()
      .eq('user_id', userId)
    if (wealthSnapshotsError) {
      logger.error('account-delete', 'Step failed', { error: wealthSnapshotsError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    // settings
    const { error: settingsError } = await serviceClient
      .from('settings')
      .delete()
      .eq('user_id', userId)
    if (settingsError) {
      logger.error('account-delete', 'Step failed', { error: settingsError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    // profiles
    const { error: profilesError } = await serviceClient
      .from('profiles')
      .delete()
      .eq('id', userId)
    if (profilesError) {
      logger.error('account-delete', 'Step failed', { error: profilesError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    // Finally delete the auth user (requires service role)
    const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(userId)
    if (deleteUserError) {
      logger.error('account-delete', 'Step failed', { error: deleteUserError.message })
      throw new Error('Account deletion failed at data cleanup step')
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error('account-delete', 'Account deletion failed', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Account deletion failed. Please contact support.' }, { status: 500 })
  }
}
