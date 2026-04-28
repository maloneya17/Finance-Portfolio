import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import type { Transaction, Bill, Asset, Debt, Goal } from '@/types/supabase'

// GET /api/export?format=csv|json&type=transactions|bills|assets|debts|goals|all
// Pro feature — returns 403 for free users

function escapeCSVValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""'
  const str = String(value)
  // Wrap in double quotes and escape internal double quotes by doubling them
  return `"${str.replace(/"/g, '""')}"`
}

/**
 * Prevent CSV formula injection by prefixing dangerous leading characters with a single quote.
 * Affected chars: = + - @ \t \r
 */
function sanitizeCsvField(value: string): string {
  if (value.length > 0 && ['=', '+', '-', '@', '\t', '\r'].includes(value[0])) {
    return `'${value}`
  }
  return value
}

function san(v: string | null | undefined): string | null | undefined {
  return v ? sanitizeCsvField(v) : v
}

function buildTransactionCSV(transactions: Transaction[]): string {
  const header = 'Date,Type,Category,Description,Amount,Notes,Tags'
  const rows = transactions.map(tx => {
    // Use | as tag delimiter — semicolons can appear in tag values
    const tags = tx.tags ? sanitizeCsvField(tx.tags.join('|')) : ''
    return [
      escapeCSVValue(tx.date),
      escapeCSVValue(tx.type),
      escapeCSVValue(san(tx.category)),
      escapeCSVValue(san(tx.description)),
      escapeCSVValue(tx.amount),
      escapeCSVValue(san(tx.notes)),
      escapeCSVValue(tags),
    ].join(',')
  })
  return [header, ...rows].join('\n')
}

function buildBillsCSV(bills: Bill[]): string {
  const header = 'Name,Amount,DayOfMonth,Category,Active'
  const rows = bills.map(b => [
    escapeCSVValue(san(b.name)),
    escapeCSVValue(b.amount),
    escapeCSVValue(b.day),
    escapeCSVValue(san(b.category)),
    escapeCSVValue(b.is_active),
  ].join(','))
  return [header, ...rows].join('\n')
}

function buildAssetsCSV(assets: Asset[]): string {
  const header = 'Name,Type,Value,Ticker,Quantity,PricePerUnit,Notes'
  const rows = assets.map(a => [
    escapeCSVValue(san(a.name)),
    escapeCSVValue(a.type),
    escapeCSVValue(a.value),
    escapeCSVValue(a.ticker),
    escapeCSVValue(a.quantity),
    escapeCSVValue(a.price_per_unit),
    escapeCSVValue(san(a.notes)),
  ].join(','))
  return [header, ...rows].join('\n')
}

function buildDebtsCSV(debts: Debt[]): string {
  const header = 'Name,Type,Balance,APR,MinPayment,Notes'
  const rows = debts.map(d => [
    escapeCSVValue(san(d.name)),
    escapeCSVValue(d.type),
    escapeCSVValue(d.balance),
    escapeCSVValue(d.apr),
    escapeCSVValue(d.min_payment),
    escapeCSVValue(san(d.notes)),
  ].join(','))
  return [header, ...rows].join('\n')
}

function buildGoalsCSV(goals: Goal[]): string {
  const header = 'Name,Target,Current,Deadline,Notes'
  const rows = goals.map(g => [
    escapeCSVValue(san(g.name)),
    escapeCSVValue(g.target),
    escapeCSVValue(g.current),
    escapeCSVValue(g.deadline),
    escapeCSVValue(san(g.notes)),
  ].join(','))
  return [header, ...rows].join('\n')
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  // 1. Authenticate user
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Rate limit per user
  if (!await rateLimit(`export:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // 3. Check subscription
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription')
    .eq('id', user.id)
    .single()

  const isPro = (profile as { subscription: string } | null)?.subscription === 'pro'

  // 4. Parse query params
  const url = new URL(request.url)
  const searchParams = url.searchParams
  const format = searchParams.get('format') ?? 'json'
  const type   = searchParams.get('type') ?? 'transactions'

  // Free users: only allow JSON transactions export
  if (!isPro && (format === 'csv' || type === 'all')) {
    return NextResponse.json({
      error: 'Upgrade to Pro for CSV export and full data export. Basic JSON export of your transactions is always free.',
    }, { status: 403 })
  }

  const validFormats = ['csv', 'json']
  const validTypes   = ['transactions', 'bills', 'assets', 'debts', 'goals', 'all']

  if (!validFormats.includes(format)) {
    return NextResponse.json({ error: 'Invalid format. Use csv or json.' }, { status: 400 })
  }
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: 'Invalid type. Use transactions, bills, assets, debts, goals, or all.' }, { status: 400 })
  }

  const today = todayString()

  try {
    // 4. Fetch requested data
    let transactions: Transaction[] = []
    let bills: Bill[] = []
    let assets: Asset[] = []
    let debts: Debt[] = []
    let goals: Goal[] = []

    if (type === 'transactions' || type === 'all') {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .limit(10000)
      if (error) throw new Error(`transactions: ${error.message}`)
      transactions = (data ?? []) as Transaction[]
    }

    if (type === 'bills' || type === 'all') {
      const { data, error } = await supabase
        .from('bills')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(10000)
      if (error) throw new Error(`bills: ${error.message}`)
      bills = (data ?? []) as Bill[]
    }

    if (type === 'assets' || type === 'all') {
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .eq('user_id', user.id)
        .limit(10000)
      if (error) throw new Error(`assets: ${error.message}`)
      assets = (data ?? []) as Asset[]
    }

    if (type === 'debts' || type === 'all') {
      const { data, error } = await supabase
        .from('debts')
        .select('*')
        .eq('user_id', user.id)
        .limit(10000)
      if (error) throw new Error(`debts: ${error.message}`)
      debts = (data ?? []) as Debt[]
    }

    if (type === 'goals' || type === 'all') {
      const { data, error } = await supabase
        .from('goals')
        .select('*')
        .eq('user_id', user.id)
        .limit(10000)
      if (error) throw new Error(`goals: ${error.message}`)
      goals = (data ?? []) as Goal[]
    }

    logger.info('export', 'User exported data', {
      userId: user.id,
      format,
      type,
      counts: { transactions: transactions.length, bills: bills.length, assets: assets.length, debts: debts.length, goals: goals.length },
    })

    // 5. Return formatted response
    if (format === 'json') {
      const payload = { transactions, bills, assets, debts, goals }
      return new NextResponse(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="infinity-finance-export-${today}.json"`,
          'Cache-Control': 'no-store, private',
        },
      })
    }

    // format === 'csv' — route to the correct builder per type
    let csv: string
    let csvFilename: string
    switch (type) {
      case 'bills':  csv = buildBillsCSV(bills);   csvFilename = `bills-${today}.csv`;   break
      case 'assets': csv = buildAssetsCSV(assets);  csvFilename = `assets-${today}.csv`;  break
      case 'debts':  csv = buildDebtsCSV(debts);    csvFilename = `debts-${today}.csv`;   break
      case 'goals':  csv = buildGoalsCSV(goals);    csvFilename = `goals-${today}.csv`;   break
      default:       csv = buildTransactionCSV(transactions); csvFilename = `transactions-${today}.csv`
    }
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${csvFilename}"`,
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error('export', 'Export failed', { userId: user.id, error: message })
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
