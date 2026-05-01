'use client'

import Link from 'next/link'
import { useFinanceStore } from '@/store/finance'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'

interface Props { sym: string }

export function RecentTransactions({ sym }: Props) {
  const txs         = useFinanceStore(s => s.getMonthTransactions())
  const allTxs      = useFinanceStore(s => s.transactions)
  const privacy     = useFinanceStore(s => s.privacyMode)
  const recent      = [...txs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recent Transactions</CardTitle>
          <Link href="/transactions" className="text-xs font-semibold flex items-center gap-1 hover:underline" style={{ color: 'var(--ios-blue)' }}>
            View all <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {allTxs.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-muted p-8 text-center">
            <div className="text-4xl mb-3">💸</div>
            <h3 className="font-semibold mb-1">Add your first transaction</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Track your income and expenses to see insights about your spending.
            </p>
            <Link
              href="/transactions"
              className="inline-flex items-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
            >
              Add Transaction →
            </Link>
          </div>
        ) : recent.length === 0 ? (
          <div className="text-center py-10 text-slate-400 dark:text-slate-500">
            <div className="text-3xl mb-2">💸</div>
            <p className="text-sm">No transactions yet this month</p>
            <Link href="/transactions" className="text-xs font-semibold mt-2 inline-block" style={{ color: 'var(--ios-blue)' }}>
              Add your first →
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-50 dark:divide-slate-800" role="list">
            {recent.map(tx => (
              <li key={tx.id} className="flex items-center gap-3 py-2.5 group">
                {/* Category dot */}
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: tx.type === 'income' ? 'var(--ios-green)' : 'var(--ios-red)' }}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{tx.description}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{tx.category} · {tx.date}</p>
                </div>
                <span
                  className={cn('text-sm font-semibold shrink-0 tabular-nums', privacy && 'blur-[5px] select-none')}
                  aria-hidden={privacy || undefined}
                  style={{ color: tx.type === 'income' ? 'var(--ios-green)' : 'var(--ios-red)' }}
                >
                  {privacy ? '••••' : `${tx.type === 'income' ? '+' : '-'}${formatCurrency(tx.amount, sym)}`}
                </span>
                {privacy && <span className="sr-only">Amount hidden</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
