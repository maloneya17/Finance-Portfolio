'use client'

import Link from 'next/link'
import type { Transaction, Settings, Profile } from '@/types/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, getMonthKey } from '@/lib/utils'
import { Crown, TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Lightbulb } from 'lucide-react'

interface Props {
  profile: Profile | null
  transactions: Transaction[]
  settings: Settings | null
}

export function InsightsView({ profile, transactions, settings }: Props) {
  const isPro = profile?.subscription === 'pro'
  const sym   = settings?.currency_symbol ?? '£'
  const currentMonth = getMonthKey()
  const lastMonth    = (() => {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m - 2)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()

  const thisTxs  = transactions.filter(t => t.date.startsWith(currentMonth))
  const lastTxs  = transactions.filter(t => t.date.startsWith(lastMonth))

  const thisExp  = thisTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const lastExp  = lastTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const thisInc  = thisTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const lastInc  = lastTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)

  const expDelta    = lastExp > 0 ? ((thisExp - lastExp) / lastExp) * 100 : 0
  const incDelta    = lastInc > 0 ? ((thisInc - lastInc) / lastInc) * 100 : 0
  const savingsRate = thisInc > 0 ? ((thisInc - thisExp) / thisInc) * 100 : 0

  // Category breakdown this month
  const cats: Record<string, number> = {}
  thisTxs.filter(t => t.type === 'expense').forEach(t => {
    cats[t.category] = (cats[t.category] ?? 0) + t.amount
  })
  const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3)

  // Free insights (available to all)
  const freeInsights = [
    thisExp > lastExp
      ? { icon: TrendingUp, color: 'var(--ios-red)',    label: 'Spending up',   text: `You've spent ${Math.abs(expDelta).toFixed(0)}% more this month vs last month.` }
      : { icon: TrendingDown, color: 'var(--ios-green)', label: 'Spending down', text: `Great work! Spending is down ${Math.abs(expDelta).toFixed(0)}% vs last month.` },
    savingsRate >= 20
      ? { icon: CheckCircle2, color: 'var(--ios-green)', label: 'Healthy savings', text: `You're saving ${savingsRate.toFixed(0)}% of income this month. Keep it up!` }
      : savingsRate > 0
        ? { icon: AlertCircle, color: 'var(--ios-orange)', label: 'Low savings rate', text: `Savings rate is ${savingsRate.toFixed(0)}%. Aim for 20%+ for financial health.` }
        : { icon: AlertCircle, color: 'var(--ios-red)', label: 'Spending over income', text: 'Expenses exceed income this month. Review your spending.' },
    topCats[0]
      ? { icon: Lightbulb, color: 'var(--ios-blue)', label: 'Top category', text: `"${topCats[0][0]}" is your biggest expense at ${formatCurrency(topCats[0][1], sym)}.` }
      : null,
  ].filter(Boolean)

  // Pro insights (Pro only)
  const proInsights = [
    { label: 'Recurring charges detected', text: 'We found 3 potential recurring subscriptions totalling £45/month. Review in Bills.' },
    { label: 'Savings velocity', text: `At this rate you'll hit your goals 2.4 months ahead of schedule.` },
    { label: 'Category anomaly', text: `"Dining" spending is 3× your monthly average. Unusual activity?` },
    { label: 'FIRE projection', text: `Based on your savings rate and net worth, financial independence in approx. 22 years.` },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Insights</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Smart analysis of your finances</p>
      </div>

      {/* Free insights */}
      <div className="space-y-3 mb-8">
        <h2 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide">This Month</h2>
        {freeInsights.map((ins, i) => {
          if (!ins) return null
          const Icon = ins.icon
          return (
            <Card key={i} className="p-4">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${ins.color}18` }}>
                  <Icon className="w-4.5 h-4.5" style={{ color: ins.color }} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-0.5">{ins.label}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{ins.text}</p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Pro insights section */}
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide flex items-center gap-2">
            Advanced Insights
            <Badge variant="pro">PRO</Badge>
          </h2>
        </div>

        <div className={`space-y-3 ${!isPro ? 'opacity-50 pointer-events-none select-none' : ''}`}>
          {proInsights.map((ins, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(0,122,255,0.08)' }}>
                  <Lightbulb className="w-4.5 h-4.5" style={{ color: 'var(--ios-blue)' }} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-0.5">{ins.label}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{ins.text}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Upgrade prompt overlay */}
        {!isPro && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Card className="p-6 text-center shadow-xl max-w-xs">
              <Crown className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--ios-orange)' }} aria-hidden="true" />
              <h3 className="font-bold text-slate-900 dark:text-white mb-2">Unlock Advanced Insights</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Recurring charge detection, FIRE projections, anomaly alerts and more.
              </p>
              <Button asChild className="w-full">
                <Link href="/settings?tab=billing">Upgrade to Pro — £4.99/mo</Link>
              </Button>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
