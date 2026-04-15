'use client'

import type { Transaction, Settings, Profile } from '@/types/supabase'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, getMonthKey, monthKeyToLabel } from '@/lib/utils'
import { useFinanceStore } from '@/store/finance'
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Lightbulb, Target, Calendar, PiggyBank, type LucideIcon } from 'lucide-react'

interface Props {
  profile: Profile | null
  transactions: Transaction[]
  settings: Settings | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPrevMonthKey(current: string): string {
  const [y, m] = current.split('-').map(Number)
  const d = new Date(y, m - 2)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + Math.round(months))
  return d
}

function formatMonthYear(date: Date): string {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return monthKeyToLabel(key)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InsightsView({ profile, transactions, settings }: Props) {
  const isPro   = profile?.subscription === 'pro'
  const sym     = settings?.currency_symbol ?? '£'
  const today   = new Date()

  // Pull goals and budgets from the Zustand store
  const goals   = useFinanceStore(s => s.goals)
  const budgets = useFinanceStore(s => s.budgets)

  const currentMonth = getMonthKey(today)
  const prevMonth    = getPrevMonthKey(currentMonth)

  const thisTxs  = transactions.filter(t => t.date.startsWith(currentMonth))
  const lastTxs  = transactions.filter(t => t.date.startsWith(prevMonth))

  // ── FREE INSIGHT 1: Spending Trend ─────────────────────────────────────────
  const thisExpenses = thisTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100
  const lastExpenses = lastTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100

  let spendingTrendIcon:  LucideIcon
  let spendingTrendColor: string
  let spendingTrendLabel: string
  let spendingTrendText:  string

  if (lastExpenses === 0) {
    spendingTrendIcon  = AlertCircle
    spendingTrendColor = 'var(--ios-blue)'
    spendingTrendLabel = 'Spending trend'
    spendingTrendText  = 'Not enough data — add transactions from last month to see your trend.'
  } else {
    const pctChange = ((thisExpenses - lastExpenses) / lastExpenses) * 100
    if (pctChange > 0) {
      spendingTrendIcon  = TrendingUp
      spendingTrendColor = 'var(--ios-red)'
      spendingTrendLabel = 'Spending up'
      spendingTrendText  = `Spending is up ${pctChange.toFixed(0)}% vs last month (${formatCurrency(thisExpenses, sym)} vs ${formatCurrency(lastExpenses, sym)}).`
    } else if (pctChange < 0) {
      spendingTrendIcon  = TrendingDown
      spendingTrendColor = 'var(--ios-green)'
      spendingTrendLabel = 'Spending down'
      spendingTrendText  = `Spending is down ${Math.abs(pctChange).toFixed(0)}% vs last month. Great work!`
    } else {
      spendingTrendIcon  = TrendingDown
      spendingTrendColor = 'var(--ios-blue)'
      spendingTrendLabel = 'Spending stable'
      spendingTrendText  = `Spending is the same as last month (${formatCurrency(thisExpenses, sym)}).`
    }
  }

  // ── FREE INSIGHT 2: Savings Rate ──────────────────────────────────────────
  const income      = thisTxs.filter(t => t.type === 'income').reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100
  const saved       = income - thisExpenses
  const savingsRate = income > 0 ? (saved / income) * 100 : 0

  let savingsIcon:  LucideIcon
  let savingsColor: string
  let savingsLabel: string
  let savingsText:  string

  if (income === 0) {
    savingsIcon  = AlertCircle
    savingsColor = 'var(--ios-blue)'
    savingsLabel = 'Savings rate'
    savingsText  = 'No income recorded this month. Add income transactions to track your savings rate.'
  } else if (savingsRate >= 20) {
    savingsIcon  = CheckCircle2
    savingsColor = 'var(--ios-green)'
    savingsLabel = 'Healthy savings'
    savingsText  = `You saved ${savingsRate.toFixed(0)}% of income this month (${formatCurrency(saved, sym)} saved). Keep it up!`
  } else if (savingsRate > 0) {
    savingsIcon  = AlertCircle
    savingsColor = 'var(--ios-orange)'
    savingsLabel = 'Low savings rate'
    savingsText  = `You saved ${savingsRate.toFixed(0)}% of income this month (${formatCurrency(saved, sym)}). Aim for 20%+ for financial health.`
  } else {
    savingsIcon  = AlertCircle
    savingsColor = 'var(--ios-red)'
    savingsLabel = 'Spending over income'
    savingsText  = `Expenses exceed income by ${formatCurrency(Math.abs(saved), sym)} this month. Review your spending.`
  }

  // ── FREE INSIGHT 3: Top Spending Category ──────────────────────────────────
  const catTotals: Record<string, number> = {}
  thisTxs.filter(t => t.type === 'expense').forEach(t => {
    catTotals[t.category] = Math.round(((catTotals[t.category] ?? 0) * 100 + Math.round(t.amount * 100))) / 100
  })
  const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
  const topCat     = sortedCats[0]

  let topCatText: string
  if (!topCat) {
    topCatText = 'No expense data this month.'
  } else {
    const pctOfSpending = thisExpenses > 0 ? (topCat[1] / thisExpenses) * 100 : 0
    topCatText = `"${topCat[0]}" was your biggest expense at ${formatCurrency(topCat[1], sym)} (${pctOfSpending.toFixed(0)}% of spending).`
  }

  // ── PRO INSIGHT 1: Recurring Charge Detection ──────────────────────────────
  // Group all expense transactions by normalised description
  const expenseTxs = transactions.filter(t => t.type === 'expense')

  interface RecurringCandidate {
    description: string
    avgAmount:   number
    monthCount:  number
  }

  const descGroups: Record<string, { amounts: number[]; months: Set<string> }> = {}
  expenseTxs.forEach(t => {
    const key = t.description.trim().toLowerCase()
    if (!descGroups[key]) descGroups[key] = { amounts: [], months: new Set() }
    descGroups[key].amounts.push(t.amount)
    // Extract YYYY-MM from date string
    descGroups[key].months.add(t.date.slice(0, 7))
  })

  const recurringCandidates: RecurringCandidate[] = []
  for (const [desc, data] of Object.entries(descGroups)) {
    if (data.months.size < 2) continue
    const mean = data.amounts.reduce((s, a) => s + Math.round(a * 100), 0) / (data.amounts.length * 100)
    const allConsistent = data.amounts.every(a => Math.abs(a - mean) / mean <= 0.1)
    if (!allConsistent) continue
    // Find a representative display name (original casing of first occurrence)
    const original = expenseTxs.find(t => t.description.trim().toLowerCase() === desc)?.description ?? desc
    recurringCandidates.push({ description: original, avgAmount: mean, monthCount: data.months.size })
  }

  // Sort by avg amount descending
  recurringCandidates.sort((a, b) => b.avgAmount - a.avgAmount)

  const totalRecurring = recurringCandidates.reduce((s, c) => s + Math.round(c.avgAmount * 100), 0) / 100
  const top3Recurring  = recurringCandidates.slice(0, 3)

  let recurringLabel: string
  let recurringText:  string
  if (recurringCandidates.length < 2) {
    recurringLabel = 'Recurring charges'
    recurringText  = 'No recurring patterns detected yet. Add more transactions to improve detection.'
  } else {
    const listStr = top3Recurring
      .map(c => `${c.description} ${formatCurrency(c.avgAmount, sym)}`)
      .join(', ')
    recurringLabel = 'Recurring charges detected'
    recurringText  = `Found ${recurringCandidates.length} potential recurring charge${recurringCandidates.length !== 1 ? 's' : ''} totalling ${formatCurrency(totalRecurring, sym)}/month. Top: ${listStr}.`
  }

  // ── PRO INSIGHT 2: Goal Savings Velocity ──────────────────────────────────
  let velocityLabel: string
  let velocityText:  string

  if (goals.length === 0) {
    velocityLabel = 'Goal savings velocity'
    velocityText  = 'Add a savings goal to track your velocity.'
  } else {
    // Find the first goal with progress
    const activeGoals = goals.filter(g => g.target > 0)
    const goalWithProgress = activeGoals.find(g => g.current > 0) ?? activeGoals[0]

    if (!goalWithProgress) {
      velocityLabel = 'Goal savings velocity'
      velocityText  = 'Add a savings goal to track your velocity.'
    } else {
      const usedFallback = !goalWithProgress.created_at
      const startDate   = goalWithProgress.created_at
        ? new Date(goalWithProgress.created_at)
        : new Date(today.getFullYear(), today.getMonth() - 3)
      const monthsElapsed = Math.max(monthsBetween(startDate, today), 1)
      const monthlyRate   = goalWithProgress.current / monthsElapsed

      if (monthlyRate === 0) {
        velocityLabel = 'Goal savings velocity'
        velocityText  = `Start saving towards "${goalWithProgress.name}" — no contributions yet.`
      } else {
        const remaining       = goalWithProgress.target - goalWithProgress.current
        const monthsRemaining = remaining / monthlyRate
        const projectedDate   = addMonths(today, monthsRemaining)

        velocityLabel = 'Goal savings velocity'
        velocityText  = `At current pace, you'll reach "${goalWithProgress.name}" by ${formatMonthYear(projectedDate)}.`
        if (usedFallback) {
          velocityText += ' (estimate based on current balance only)'
        }
      }
    }
  }

  // ── PRO INSIGHT 3: Monthly Budget Adherence ───────────────────────────────
  let budgetLabel: string
  let budgetText:  string

  if (budgets.length === 0) {
    budgetLabel = 'Budget adherence'
    budgetText  = 'No budgets set. Add budgets in settings to track adherence.'
  } else {
    let withinCount = 0
    const overCategories: string[] = []

    budgets.forEach(budget => {
      const spent = thisTxs
        .filter(t => t.type === 'expense' && t.category === budget.category)
        .reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100
      if (spent <= budget.amount) {
        withinCount++
      } else {
        overCategories.push(budget.category)
      }
    })

    const adherencePct = Math.round((withinCount / budgets.length) * 100)
    budgetLabel = 'Monthly budget adherence'

    if (overCategories.length === 0) {
      budgetText = `You stayed within budget in all ${budgets.length} categor${budgets.length !== 1 ? 'ies' : 'y'} this month (${adherencePct}%). Excellent!`
    } else {
      const overList = overCategories.slice(0, 3).join(', ')
      const moreStr  = overCategories.length > 3 ? ` +${overCategories.length - 3} more` : ''
      budgetText = `You stayed within budget in ${withinCount} of ${budgets.length} categories (${adherencePct}%). Over budget: ${overList}${moreStr}.`
    }
  }

  // ── Build insight arrays ───────────────────────────────────────────────────
  const SpendingTrendIcon = spendingTrendIcon
  const SavingsIcon       = savingsIcon

  const freeInsights = [
    {
      icon:  SpendingTrendIcon,
      color: spendingTrendColor,
      label: spendingTrendLabel,
      text:  spendingTrendText,
    },
    {
      icon:  SavingsIcon,
      color: savingsColor,
      label: savingsLabel,
      text:  savingsText,
    },
    {
      icon:  Lightbulb,
      color: 'var(--ios-blue)',
      label: 'Top spending category',
      text:  topCatText,
    },
  ]

  const proInsights = [
    {
      icon:  PiggyBank,
      color: 'var(--ios-blue)',
      label: recurringLabel,
      text:  recurringText,
    },
    {
      icon:  Target,
      color: 'var(--ios-green)',
      label: velocityLabel,
      text:  velocityText,
    },
    {
      icon:  Calendar,
      color: 'var(--ios-orange)',
      label: budgetLabel,
      text:  budgetText,
    },
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
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide flex items-center gap-2">
            Advanced Insights
            <Badge variant="pro">PRO</Badge>
          </h2>
        </div>

        <div className="space-y-3">
          {proInsights.map((ins, i) => {
            const Icon = ins.icon
            return (
              <Card key={i} className="p-4">
                {isPro ? (
                  <div className="flex items-start gap-4">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${ins.color}18` }}>
                      <Icon className="w-4.5 h-4.5" style={{ color: ins.color }} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-0.5">{ins.label}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{ins.text}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="text-2xl mb-2">🔒</div>
                    <p className="text-sm font-medium">Pro feature</p>
                    <p className="text-xs text-muted-foreground mt-1">Upgrade to unlock advanced insights</p>
                    <button
                      onClick={async () => {
                        const res = await fetch('/api/stripe/checkout', { method: 'POST' })
                        if (res.ok) { const d = await res.json(); window.location.href = d.url }
                      }}
                      className="mt-3 rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-xs font-medium hover:bg-primary/90"
                    >
                      Upgrade to Pro
                    </button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
