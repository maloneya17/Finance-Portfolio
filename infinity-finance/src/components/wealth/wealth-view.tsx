'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Asset, Debt, Goal, Settings } from '@/types/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatCompact, pct, clamp } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Plus, Pencil, Trash2, TrendingUp, TrendingDown, Target } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import type { AssetInsert, DebtInsert, GoalInsert } from '@/types/supabase'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import { toast } from 'sonner'

interface Props {
  assets: Asset[]
  debts: Debt[]
  goals: Goal[]
  settings: Settings | null
  userId: string
}

type Tab = 'overview' | 'assets' | 'debts' | 'goals'

export function WealthView({ assets: initAssets, debts: initDebts, goals: initGoals, settings, userId }: Props) {
  const [tab, setTab]         = useState<Tab>('overview')
  const [assets, setAssets]   = useState(initAssets)
  const [debts, setDebts]     = useState(initDebts)
  const [goals, setGoals]     = useState(initGoals)
  const [dialog, setDialog]   = useState<{ type: 'asset' | 'debt' | 'goal'; item?: Asset | Debt | Goal } | null>(null)
  const [snapshots, setSnapshots] = useState<Array<{ date: string; net_worth: number }>>([])
  const supabase               = createClient()
  const sym                    = settings?.currency_symbol ?? '£'

  const totalAssets = assets.reduce((s, a) => s + a.value, 0)
  const totalDebts  = debts.reduce((s, d) => s + d.balance, 0)
  const netWorth    = totalAssets - totalDebts

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('wealth_snapshots')
      .select('date, net_worth')
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .limit(30)
      .then(({ data }) => {
        if (!cancelled && data) setSnapshots(data as Array<{ date: string; net_worth: number }>)
      })
    return () => { cancelled = true }
  }, [userId])

  async function recordSnapshot(): Promise<void> {
    try {
      const supabase = createClient()
      const [{ data: assetRows }, { data: debtRows }] = await Promise.all([
        supabase.from('assets').select('value').eq('user_id', userId),
        supabase.from('debts').select('balance').eq('user_id', userId),
      ])
      const snapshotAssets = (assetRows ?? []).reduce((s: number, a: { value: number }) => s + a.value, 0)
      const snapshotDebts  = (debtRows  ?? []).reduce((s: number, d: { balance: number }) => s + d.balance, 0)
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('wealth_snapshots').upsert({
        user_id:      userId,
        date:         today,
        net_worth:    snapshotAssets - snapshotDebts,
        assets_total: snapshotAssets,
        debts_total:  snapshotDebts,
      }, { onConflict: 'user_id,date' })
    } catch {
      // snapshot is non-critical — don't surface errors to the user
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: TrendingUp },
    { id: 'assets',   label: `Assets (${assets.length})`,  icon: TrendingUp  },
    { id: 'debts',    label: `Debts (${debts.length})`,    icon: TrendingDown },
    { id: 'goals',    label: `Goals (${goals.length})`,    icon: Target       },
  ]

  async function deleteAsset(id: string) {
    if (!confirm('Delete this asset? This cannot be undone.')) return
    const prev = assets
    setAssets(a => a.filter(x => x.id !== id))
    const { error } = await supabase.from('assets').delete().eq('id', id)
    if (error) { setAssets(prev); toast.error('Failed to delete asset. Please try again.'); return }
    await recordSnapshot()
  }

  async function deleteDebt(id: string) {
    if (!confirm('Delete this debt entry? This cannot be undone.')) return
    const prev = debts
    setDebts(d => d.filter(x => x.id !== id))
    const { error } = await supabase.from('debts').delete().eq('id', id)
    if (error) { setDebts(prev); toast.error('Failed to delete debt. Please try again.'); return }
    await recordSnapshot()
  }

  async function deleteGoal(id: string) {
    if (!confirm('Delete this goal? This cannot be undone.')) return
    const prev = goals
    setGoals(g => g.filter(x => x.id !== id))
    const { error } = await supabase.from('goals').delete().eq('id', id)
    if (error) { setGoals(prev); toast.error('Failed to delete goal. Please try again.') }
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Wealth</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Assets, debts, and goals</p>
        </div>
        <div className="flex gap-2">
          {tab === 'assets' && <Button size="sm" onClick={() => setDialog({ type: 'asset' })}><Plus className="w-4 h-4" aria-hidden="true" /> Add Asset</Button>}
          {tab === 'debts'  && <Button size="sm" onClick={() => setDialog({ type: 'debt' })}><Plus className="w-4 h-4" aria-hidden="true" /> Add Debt</Button>}
          {tab === 'goals'  && <Button size="sm" onClick={() => setDialog({ type: 'goal' })}><Plus className="w-4 h-4" aria-hidden="true" /> Add Goal</Button>}
        </div>
      </div>

      {/* Net worth hero */}
      <Card className="p-6 mb-6 bg-gradient-to-br from-slate-900 to-slate-800 dark:from-slate-800 dark:to-slate-900 text-white border-0">
        <p className="text-sm text-slate-400 mb-1">Net Worth</p>
        <p className="text-4xl font-bold mb-4" style={{ color: netWorth >= 0 ? 'var(--ios-teal)' : 'var(--ios-red)' }}>
          {formatCompact(netWorth, sym)}
        </p>
        <div className="flex gap-8">
          <div>
            <p className="text-xs text-slate-400">Assets</p>
            <p className="text-lg font-bold" style={{ color: 'var(--ios-green)' }}>{formatCompact(totalAssets, sym)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Debts</p>
            <p className="text-lg font-bold" style={{ color: 'var(--ios-red)' }}>-{formatCompact(totalDebts, sym)}</p>
          </div>
        </div>
        {snapshots.length >= 2 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Net Worth History</p>
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={snapshots}>
                <Line
                  type="monotone"
                  dataKey="net_worth"
                  stroke="var(--ios-blue)"
                  strokeWidth={2}
                  dot={false}
                />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v), sym)}
                  labelFormatter={(label) => label}
                  contentStyle={{ fontSize: 12 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 py-2 text-xs font-semibold rounded-lg transition',
              tab === t.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Asset breakdown */}
          <Card>
            <CardHeader><CardTitle className="text-base">Asset Breakdown</CardTitle></CardHeader>
            <CardContent className="pt-0 space-y-3">
              {assets.length === 0 ? <p className="text-sm text-slate-400 text-center py-4">No assets added yet</p> : (
                assets.map(a => (
                  <div key={a.id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-xs font-semibold">{a.name}</span>
                        <span className="text-xs" style={{ color: 'var(--ios-green)' }}>{formatCurrency(a.value, sym)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full">
                        <div className="h-full rounded-full" style={{ width: `${pct(a.value, totalAssets)}%`, background: 'var(--ios-green)' }} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Debt breakdown */}
          <Card>
            <CardHeader><CardTitle className="text-base">Debt Breakdown</CardTitle></CardHeader>
            <CardContent className="pt-0 space-y-3">
              {debts.length === 0 ? <p className="text-sm text-slate-400 text-center py-4">Debt free! 🎉</p> : (
                debts.map(d => (
                  <div key={d.id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-xs font-semibold">{d.name}</span>
                        <span className="text-xs" style={{ color: 'var(--ios-red)' }}>{formatCurrency(d.balance, sym)}</span>
                      </div>
                      <div className="flex gap-2 text-[10px] text-slate-400">
                        <span>{d.apr}% APR</span>
                        <span>·</span>
                        <span>Min {formatCurrency(d.min_payment, sym)}/mo</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Assets list */}
      {tab === 'assets' && (
        <Card>
          {assets.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <div className="text-4xl mb-3">🏦</div>
              <p className="text-sm mb-3">No assets tracked yet</p>
              <Button variant="tint" size="sm" onClick={() => setDialog({ type: 'asset' })}>Add your first asset</Button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-50 dark:divide-slate-800" role="list">
              {assets.map(a => (
                <li key={a.id} className="flex items-center gap-4 px-5 py-4 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{a.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px]">{a.type}</Badge>
                      {a.ticker && <span className="text-xs text-slate-400">{a.ticker}</span>}
                    </div>
                  </div>
                  <p className="text-sm font-bold" style={{ color: 'var(--ios-green)' }}>{formatCurrency(a.value, sym)}</p>
                  <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                    <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ type: 'asset', item: a })} aria-label={`Edit ${a.name}`} className="text-slate-400 hover:text-[var(--ios-blue)]"><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => deleteAsset(a.id)} aria-label={`Delete ${a.name}`} className="text-slate-400 hover:text-[var(--ios-red)]"><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Debts list */}
      {tab === 'debts' && (
        <Card>
          {debts.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-sm">Debt free! Add a debt to track payoff progress.</p>
              <Button variant="tint" size="sm" className="mt-3" onClick={() => setDialog({ type: 'debt' })}>Add a debt</Button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-50 dark:divide-slate-800" role="list">
              {debts.map(d => (
                <li key={d.id} className="flex items-center gap-4 px-5 py-4 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{d.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="destructive" className="text-[10px]">{d.type.replace('_', ' ')}</Badge>
                      <span className="text-xs text-slate-400">{d.apr}% APR</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold" style={{ color: 'var(--ios-red)' }}>{formatCurrency(d.balance, sym)}</p>
                    <p className="text-xs text-slate-400">Min {formatCurrency(d.min_payment, sym)}/mo</p>
                  </div>
                  <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                    <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ type: 'debt', item: d })} aria-label={`Edit ${d.name}`} className="text-slate-400 hover:text-[var(--ios-blue)]"><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => deleteDebt(d.id)} aria-label={`Delete ${d.name}`} className="text-slate-400 hover:text-[var(--ios-red)]"><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Goals list */}
      {tab === 'goals' && (
        <div className="space-y-4">
          {goals.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No goals yet"
              description="Set a savings goal to start working towards your financial future."
              action={<Button variant="tint" size="sm" onClick={() => setDialog({ type: 'goal' })}>Add first goal</Button>}
            />
          ) : goals.map(g => {
            const p = pct(g.current, g.target)
            const color = p >= 100 ? 'var(--ios-green)' : p > 50 ? 'var(--ios-blue)' : 'var(--ios-orange)'
            return (
              <Card key={g.id} className="p-5">
                <div className="flex items-start gap-3">
                  {g.emoji && <span className="text-2xl" aria-hidden="true">{g.emoji}</span>}
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-slate-800 dark:text-slate-100">{g.name}</p>
                        {g.deadline && <p className="text-xs text-slate-400">By {g.deadline}</p>}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ type: 'goal', item: g })} aria-label={`Edit ${g.name}`} className="text-slate-400 hover:text-[var(--ios-blue)]"><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => deleteGoal(g.id)} aria-label={`Delete ${g.name}`} className="text-slate-400 hover:text-[var(--ios-red)]"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full mb-2">
                      <div className="h-full rounded-full transition-all" style={{ width: `${clamp(p, 0, 100)}%`, background: color }} />
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{formatCurrency(g.current, sym)} saved</span>
                      <span style={{ color }}>{p.toFixed(0)}%</span>
                      <span>{formatCurrency(g.target, sym)} goal</span>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Dialogs */}
      <Dialog open={!!dialog} onOpenChange={v => { if (!v) setDialog(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === 'asset' ? (dialog.item ? 'Edit Asset' : 'Add Asset') :
               dialog?.type === 'debt'  ? (dialog.item ? 'Edit Debt'  : 'Add Debt')  :
                                          (dialog?.item ? 'Edit Goal'  : 'Add Goal') }
            </DialogTitle>
          </DialogHeader>
          {dialog?.type === 'asset' && (
            <AssetForm asset={dialog.item as Asset} sym={sym} userId={userId}
              onSuccess={async (a) => { if (dialog.item) setAssets(assets.map(x => x.id === a.id ? a : x)); else setAssets([...assets, a]); setDialog(null); await recordSnapshot() }} />
          )}
          {dialog?.type === 'debt' && (
            <DebtForm debt={dialog.item as Debt} sym={sym} userId={userId}
              onSuccess={async (d) => { if (dialog.item) setDebts(debts.map(x => x.id === d.id ? d : x)); else setDebts([...debts, d]); setDialog(null); await recordSnapshot() }} />
          )}
          {dialog?.type === 'goal' && (
            <GoalForm goal={dialog.item as Goal} sym={sym} userId={userId}
              onSuccess={g => { if (dialog.item) setGoals(goals.map(x => x.id === g.id ? g : x)); else setGoals([...goals, g]); setDialog(null) }} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Mini forms ───────────────────────────────────────────────────────────────

function AssetForm({ asset, sym, userId, onSuccess }: { asset?: Asset; sym: string; userId: string; onSuccess: (a: Asset) => void }) {
  const supabase = createClient()
  const [name, setName]       = useState(asset?.name ?? '')
  const [type, setType]       = useState(asset?.type ?? 'cash')
  const [value, setValue]     = useState(asset ? String(asset.value) : '')
  const [ticker, setTicker]   = useState(asset?.ticker ?? '')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const parsedValue = parseFloat(value)
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        toast.error('Please enter a valid value.')
        setLoading(false)
        return
      }
      const assetPayload: AssetInsert = { user_id: userId, name, type: type as AssetInsert['type'], value: parsedValue, ticker: ticker || null }
      if (asset) {
        const { data, error } = await supabase.from('assets').update(assetPayload).eq('id', asset.id).select().single()
        if (error || !data) {
          toast.error('Failed to save asset. Please try again.')
          return
        }
        onSuccess(data as Asset)
      } else {
        const { data, error } = await supabase.from('assets').insert(assetPayload).select().single()
        if (error || !data) {
          toast.error('Failed to save asset. Please try again.')
          return
        }
        onSuccess(data as Asset)
      }
    } catch {
      toast.error('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Name</label><Input value={name} onChange={e => setName(e.target.value)} placeholder="ISA, House, etc." required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Type</label>
          <Select value={type} onValueChange={v => setType(v as typeof type)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['cash','stocks','crypto','property','pension','other'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Value ({sym})</label><Input type="number" step="0.01" min="0" value={value} onChange={e => setValue(e.target.value)} placeholder="0.00" required /></div>
      </div>
      <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Ticker (optional)</label><Input value={ticker} onChange={e => setTicker(e.target.value)} placeholder="AAPL, ETH, etc." /></div>
      <Button type="submit" className="w-full" loading={loading}>{asset ? 'Update' : 'Add Asset'}</Button>
    </form>
  )
}

function DebtForm({ debt, sym, userId, onSuccess }: { debt?: Debt; sym: string; userId: string; onSuccess: (d: Debt) => void }) {
  const supabase = createClient()
  const [name, setName]     = useState(debt?.name ?? '')
  const [balance, setBalance] = useState(debt ? String(debt.balance) : '')
  const [apr, setApr]       = useState(debt ? String(debt.apr) : '0')
  const [minPayment, setMinPayment] = useState(debt ? String(debt.min_payment) : '')
  const [debtType, setDebtType] = useState(debt?.type ?? 'other')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const parsedBalance = parseFloat(balance)
      const parsedApr = parseFloat(apr)
      const parsedMinPayment = parseFloat(minPayment || '0')
      if (!Number.isFinite(parsedBalance) || parsedBalance < 0) {
        toast.error('Please enter a valid balance.')
        setLoading(false)
        return
      }
      if (!Number.isFinite(parsedApr) || parsedApr < 0) {
        toast.error('Please enter a valid APR.')
        setLoading(false)
        return
      }
      const debtPayload: DebtInsert = { user_id: userId, name, balance: parsedBalance, apr: parsedApr, min_payment: Number.isFinite(parsedMinPayment) ? parsedMinPayment : 0, type: debtType as DebtInsert['type'] }
      if (debt) {
        const { data, error } = await supabase.from('debts').update(debtPayload).eq('id', debt.id).select().single()
        if (error || !data) {
          toast.error('Failed to save debt. Please try again.')
          return
        }
        onSuccess(data as Debt)
      } else {
        const { data, error } = await supabase.from('debts').insert(debtPayload).select().single()
        if (error || !data) {
          toast.error('Failed to save debt. Please try again.')
          return
        }
        onSuccess(data as Debt)
      }
    } catch {
      toast.error('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Name</label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Credit card, mortgage, etc." required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Balance ({sym})</label><Input type="number" step="0.01" min="0" value={balance} onChange={e => setBalance(e.target.value)} placeholder="0.00" required /></div>
        <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">APR (%)</label><Input type="number" step="0.01" min="0" value={apr} onChange={e => setApr(e.target.value)} placeholder="0.00" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Min payment/mo ({sym})</label><Input type="number" step="0.01" min="0" value={minPayment} onChange={e => setMinPayment(e.target.value)} placeholder="0.00" /></div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Type</label>
          <Select value={debtType} onValueChange={v => setDebtType(v as typeof debtType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['credit_card','loan','mortgage','student','other'].map(t => <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" className="w-full" loading={loading}>{debt ? 'Update' : 'Add Debt'}</Button>
    </form>
  )
}

function GoalForm({ goal, sym, userId, onSuccess }: { goal?: Goal; sym: string; userId: string; onSuccess: (g: Goal) => void }) {
  const supabase = createClient()
  const [name, setName]         = useState(goal?.name ?? '')
  const [target, setTarget]     = useState(goal ? String(goal.target) : '')
  const [current, setCurrent]   = useState(goal ? String(goal.current) : '0')
  const [emoji, setEmoji]       = useState(goal?.emoji ?? '')
  const [deadline, setDeadline] = useState(goal?.deadline ?? '')
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const parsedTarget = parseFloat(target)
      const parsedCurrent = parseFloat(current || '0')
      if (!Number.isFinite(parsedTarget) || parsedTarget < 0) {
        toast.error('Please enter a valid target amount.')
        setLoading(false)
        return
      }
      const goalPayload: GoalInsert = { user_id: userId, name, target: parsedTarget, current: Number.isFinite(parsedCurrent) ? parsedCurrent : 0, emoji: emoji || null, deadline: deadline || null, notes: notes || null }
      if (goal) {
        const { data, error } = await supabase.from('goals').update(goalPayload).eq('id', goal.id).select().single()
        if (error || !data) {
          toast.error('Failed to save goal. Please try again.')
          return
        }
        onSuccess(data as Goal)
      } else {
        const { data, error } = await supabase.from('goals').insert(goalPayload).select().single()
        if (error || !data) {
          toast.error('Failed to save goal. Please try again.')
          return
        }
        onSuccess(data as Goal)
      }
    } catch {
      toast.error('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-3">
        <div className="w-16"><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Emoji</label><Input value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🎯" className="text-center" /></div>
        <div className="flex-1"><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Goal name</label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Emergency fund, holiday, etc." required /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Target ({sym})</label><Input type="number" step="0.01" min="0" value={target} onChange={e => setTarget(e.target.value)} placeholder="0.00" required /></div>
        <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Saved so far ({sym})</label><Input type="number" step="0.01" min="0" value={current} onChange={e => setCurrent(e.target.value)} placeholder="0.00" /></div>
      </div>
      <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Target date</label><Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></div>
      <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Notes (optional)</label><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this goal…" rows={2} className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
      <Button type="submit" className="w-full" loading={loading}>{goal ? 'Update' : 'Add Goal'}</Button>
    </form>
  )
}
