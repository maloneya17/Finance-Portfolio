import { createClient as createAnonClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST() {
  // 1. Verify the requesting user is authenticated via anon client
  const anonClient = await createAnonClient()
  const { data: { user }, error: authError } = await anonClient.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    if (billFetchError) throw new Error(`bills fetch: ${billFetchError.message}`)

    const billIds = (billRows ?? []).map((r: { id: string }) => r.id)
    if (billIds.length > 0) {
      const { error: billPaymentsError } = await serviceClient
        .from('bill_payments')
        .delete()
        .in('bill_id', billIds)
      if (billPaymentsError) throw new Error(`bill_payments: ${billPaymentsError.message}`)
    }

    // transactions
    const { error: transactionsError } = await serviceClient
      .from('transactions')
      .delete()
      .eq('user_id', userId)
    if (transactionsError) throw new Error(`transactions: ${transactionsError.message}`)

    // bills
    const { error: billsError } = await serviceClient
      .from('bills')
      .delete()
      .eq('user_id', userId)
    if (billsError) throw new Error(`bills: ${billsError.message}`)

    // assets
    const { error: assetsError } = await serviceClient
      .from('assets')
      .delete()
      .eq('user_id', userId)
    if (assetsError) throw new Error(`assets: ${assetsError.message}`)

    // debts
    const { error: debtsError } = await serviceClient
      .from('debts')
      .delete()
      .eq('user_id', userId)
    if (debtsError) throw new Error(`debts: ${debtsError.message}`)

    // goals
    const { error: goalsError } = await serviceClient
      .from('goals')
      .delete()
      .eq('user_id', userId)
    if (goalsError) throw new Error(`goals: ${goalsError.message}`)

    // budgets
    const { error: budgetsError } = await serviceClient
      .from('budgets')
      .delete()
      .eq('user_id', userId)
    if (budgetsError) throw new Error(`budgets: ${budgetsError.message}`)

    // wealth_snapshots
    const { error: wealthSnapshotsError } = await serviceClient
      .from('wealth_snapshots')
      .delete()
      .eq('user_id', userId)
    if (wealthSnapshotsError) throw new Error(`wealth_snapshots: ${wealthSnapshotsError.message}`)

    // settings
    const { error: settingsError } = await serviceClient
      .from('settings')
      .delete()
      .eq('user_id', userId)
    if (settingsError) throw new Error(`settings: ${settingsError.message}`)

    // profiles
    const { error: profilesError } = await serviceClient
      .from('profiles')
      .delete()
      .eq('id', userId)
    if (profilesError) throw new Error(`profiles: ${profilesError.message}`)

    // Finally delete the auth user (requires service role)
    const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(userId)
    if (deleteUserError) throw new Error(`auth.deleteUser: ${deleteUserError.message}`)

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
