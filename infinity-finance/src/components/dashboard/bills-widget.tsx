'use client'

import Link from 'next/link'
import { useFinanceStore } from '@/store/finance'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatCurrency, ordinal } from '@/lib/utils'
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props { sym: string }

export function BillsWidget({ sym }: Props) {
  const bills       = useFinanceStore(s => s.bills)
  const payments    = useFinanceStore(s => s.billPayments)
  const privacy      = useFinanceStore(s => s.privacyMode)

  const paidIds = new Set(payments.filter(p => p.paid).map(p => p.bill_id))
  const unpaid  = bills.filter(b => !paidIds.has(b.id)).slice(0, 5)
  const totalUnpaid = unpaid.reduce((s, b) => s + b.amount, 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Bills Due</CardTitle>
          <Link href="/bills" className="text-xs font-semibold flex items-center gap-1 hover:underline" style={{ color: 'var(--ios-blue)' }}>
            All bills <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {bills.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No bills set up yet</p>
        ) : unpaid.length === 0 ? (
          <div className="text-center py-4">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--ios-green)' }} />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">All bills paid!</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-50 dark:divide-slate-800" role="list">
              {unpaid.map(bill => (
                <li key={bill.id} className="flex items-center gap-3 py-2.5">
                  <Circle className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{bill.name}</p>
                    <p className="text-xs text-slate-400">Due {ordinal(bill.day)}</p>
                  </div>
                  <span className={cn('text-sm font-semibold shrink-0', privacy && 'blur-[5px] select-none')} aria-hidden={privacy || undefined} style={{ color: 'var(--ios-red)' }}>
                    {privacy ? '••••' : formatCurrency(bill.amount, sym)}
                  </span>
                  {privacy && <span className="sr-only">Amount hidden</span>}
                </li>
              ))}
            </ul>
            {totalUnpaid > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs">
                <span className="text-slate-500">Total outstanding</span>
                <span className={cn('font-bold', privacy && 'blur-[4px] select-none')} aria-hidden={privacy || undefined} style={{ color: 'var(--ios-red)' }}>
                  {privacy ? '••••' : formatCurrency(totalUnpaid, sym)}
                </span>
                {privacy && <span className="sr-only">Amount hidden</span>}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
