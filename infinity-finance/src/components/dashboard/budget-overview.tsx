'use client'

import { useRouter } from 'next/navigation'
import { useFinanceStore } from '@/store/finance'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatCompact, pct, clamp } from '@/lib/utils'

interface Props { sym: string }

export function BudgetOverview({ sym }: Props) {
  const router  = useRouter()
  const budgets = useFinanceStore(s => s.budgets)
  const txs     = useFinanceStore(s => s.getMonthTransactions())
  const privacy = useFinanceStore(s => s.privacyMode)

  // Tally expenses per category for this month
  const spent: Record<string, number> = {}
  txs.filter(t => t.type === 'expense').forEach(t => {
    spent[t.category] = (spent[t.category] ?? 0) + t.amount
  })

  const activeBudgets = budgets.filter(b => b.amount > 0)
  if (activeBudgets.length === 0) return null

  const fmt = (n: number) => privacy ? '••••' : formatCompact(n, sym)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Budget</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {activeBudgets.map(b => {
          const s     = spent[b.category] ?? 0
          const over  = s > b.amount
          const p     = pct(s, b.amount)
          const color = over ? 'var(--ios-red)' : p > 80 ? 'var(--ios-orange)' : 'var(--ios-blue)'

          return (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              aria-label={`View ${b.category} transactions`}
              className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors px-1 -mx-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={() => router.push(`/transactions?category=${encodeURIComponent(b.category)}`)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') router.push(`/transactions?category=${encodeURIComponent(b.category)}`) }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{b.category}</span>
                <span className="text-xs font-medium" aria-hidden={privacy || undefined}>
                  <span style={{ color }}>{fmt(s)}</span>
                  <span className="text-slate-400"> / {fmt(b.amount)}</span>
                </span>
                {privacy && <span className="sr-only">Amount hidden</span>}
              </div>
              <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${clamp(p, 0, 100)}%`, background: color }}
                  role="progressbar"
                  aria-valuenow={Math.round(p)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progress"
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
