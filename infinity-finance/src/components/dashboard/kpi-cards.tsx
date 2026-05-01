'use client'

import { useFinanceStore } from '@/store/finance'
import { Card } from '@/components/ui/card'
import { formatCompact, pct } from '@/lib/utils'
import { TrendingUp, TrendingDown, Wallet, PiggyBank } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KpiCardsProps { sym: string }

export function KpiCards({ sym }: KpiCardsProps) {
  const income   = useFinanceStore(s => s.getIncome())
  const expenses = useFinanceStore(s => s.getExpenses())
  const netWorth = useFinanceStore(s => s.getNetWorth())
  const privacy  = useFinanceStore(s => s.privacyMode)

  const balance      = income - expenses
  const savingsRate  = income > 0 ? pct(balance, income) : 0
  const isDeficit    = balance < 0

  const fmt = (n: number) => privacy ? '••••' : formatCompact(n, sym)

  const cards = [
    {
      label:   'Income',
      value:   fmt(income),
      icon:    TrendingUp,
      color:   'var(--ios-green)',
      bg:      'rgba(52,199,89,0.08)',
    },
    {
      label:   'Expenses',
      value:   fmt(expenses),
      icon:    TrendingDown,
      color:   'var(--ios-red)',
      bg:      'rgba(255,59,48,0.08)',
    },
    {
      label:   isDeficit ? 'Deficit' : 'Balance',
      value:   fmt(Math.abs(balance)),
      icon:    Wallet,
      color:   isDeficit ? 'var(--ios-red)' : 'var(--ios-blue)',
      bg:      isDeficit ? 'rgba(255,59,48,0.08)' : 'rgba(0,122,255,0.08)',
    },
    {
      label:   'Net Worth',
      value:   fmt(netWorth),
      icon:    PiggyBank,
      color:   netWorth >= 0 ? 'var(--ios-purple)' : 'var(--ios-red)',
      bg:      netWorth >= 0 ? 'rgba(175,82,222,0.08)' : 'rgba(255,59,48,0.08)',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(card => {
        const Icon = card.icon
        return (
          <Card key={card.label} className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{card.label}</span>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: card.bg }}>
                <Icon className="w-4 h-4" aria-hidden="true" style={{ color: card.color }} />
              </div>
            </div>
            <div
              className={cn('text-2xl font-bold tabular-nums inline-block min-w-[6ch]', privacy && 'blur-[6px] select-none')}
              aria-hidden={privacy || undefined}
              style={{ color: card.color }}
            >
              {card.value}
            </div>
            {privacy && <span className="sr-only">Amount hidden</span>}
            {card.label === (isDeficit ? 'Deficit' : 'Balance') && income > 0 && (
              <div className="text-[11px] text-slate-400 mt-1">{savingsRate.toFixed(0)}% savings rate</div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
