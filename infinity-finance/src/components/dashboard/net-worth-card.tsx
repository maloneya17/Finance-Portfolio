'use client'

import Link from 'next/link'
import { useFinanceStore } from '@/store/finance'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatCompact } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props { sym: string }

export function NetWorthCard({ sym }: Props) {
  const assets      = useFinanceStore(s => s.assets)
  const debts       = useFinanceStore(s => s.debts)
  const privacy     = useFinanceStore(s => s.privacyMode)
  const getNetWorth = useFinanceStore(s => s.getNetWorth)

  // Use store's Decimal-safe computation for the displayed figure
  const netWorth    = getNetWorth()
  const totalAssets = assets.reduce((s, a) => s + a.value, 0)
  const totalDebts  = debts.reduce((s, d) => s + d.balance, 0)

  const fmt = (n: number) => privacy ? '••••' : formatCompact(n, sym)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Net Worth</CardTitle>
          <Link href="/wealth" className="text-xs font-semibold flex items-center gap-1 hover:underline" style={{ color: 'var(--ios-blue)' }}>
            Details <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          className="text-3xl font-bold mb-4 tabular-nums"
          style={{ color: netWorth >= 0 ? 'var(--ios-purple)' : 'var(--ios-red)' }}
        >
          <span className="inline-block min-w-[6ch]" aria-hidden={privacy || undefined}>{fmt(netWorth)}</span>
          {privacy && <span className="sr-only">Amount hidden</span>}
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">Assets</span>
            <span className="font-semibold tabular-nums" style={{ color: 'var(--ios-green)' }}>
              <span className="inline-block min-w-[5ch]" aria-hidden={privacy || undefined}>{fmt(totalAssets)}</span>
              {privacy && <span className="sr-only">Amount hidden</span>}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">Debts</span>
            <span className="font-semibold tabular-nums" style={{ color: 'var(--ios-red)' }}>
              <span className="inline-block min-w-[5ch]" aria-hidden={privacy || undefined}>{privacy ? '••••' : `-${fmt(totalDebts)}`}</span>
              {privacy && <span className="sr-only">Amount hidden</span>}
            </span>
          </div>

          {/* Visual bar */}
          {totalAssets > 0 && (() => {
            const denom = totalAssets + totalDebts
            const assetPct = denom > 0 ? Math.min(100, (totalAssets / denom) * 100) : 100
            const debtPct  = denom > 0 ? (totalDebts / denom) * 100 : 0
            return (
              <div className="mt-3">
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${assetPct}%`,
                      background: 'linear-gradient(90deg, var(--ios-green), var(--ios-teal))',
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>Assets {assetPct.toFixed(0)}%</span>
                  <span>Debts {debtPct.toFixed(0)}%</span>
                </div>
              </div>
            )
          })()}
        </div>
      </CardContent>
    </Card>
  )
}
