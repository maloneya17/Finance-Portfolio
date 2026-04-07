'use client'

import Link from 'next/link'
import { useFinanceStore } from '@/store/finance'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatCurrency, formatCompact } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props { sym: string }

export function NetWorthCard({ sym }: Props) {
  const assets  = useFinanceStore(s => s.assets)
  const debts   = useFinanceStore(s => s.debts)
  const privacy = useFinanceStore(s => s.privacyMode)

  const totalAssets = assets.reduce((s, a) => s + a.value, 0)
  const totalDebts  = debts.reduce((s, d) => s + d.balance, 0)
  const netWorth    = totalAssets - totalDebts

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
          className={cn('text-3xl font-bold mb-4', privacy && 'blur-[6px] select-none')}
          style={{ color: netWorth >= 0 ? 'var(--ios-purple)' : 'var(--ios-red)' }}
        >
          {fmt(netWorth)}
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">Assets</span>
            <span className={cn('font-semibold', privacy && 'blur-[5px]')} style={{ color: 'var(--ios-green)' }}>
              {fmt(totalAssets)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">Debts</span>
            <span className={cn('font-semibold', privacy && 'blur-[5px]')} style={{ color: 'var(--ios-red)' }}>
              -{fmt(totalDebts)}
            </span>
          </div>

          {/* Visual bar */}
          {totalAssets > 0 && (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (totalAssets / (totalAssets + totalDebts)) * 100)}%`,
                    background: 'linear-gradient(90deg, var(--ios-green), var(--ios-teal))',
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>Assets {((totalAssets / (totalAssets + totalDebts)) * 100).toFixed(0)}%</span>
                <span>Debts {((totalDebts / (totalAssets + totalDebts)) * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
