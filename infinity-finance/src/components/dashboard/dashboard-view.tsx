'use client'

import { useEffect } from 'react'
import { useFinanceStore } from '@/store/finance'
import type { Transaction, Bill, BillPayment, Asset, Debt, Goal, Budget, Settings } from '@/types/supabase'
import { KpiCards } from './kpi-cards'
import { RecentTransactions } from './recent-transactions'
import { BudgetOverview } from './budget-overview'
import { NetWorthCard } from './net-worth-card'
import { BillsWidget } from './bills-widget'
import { GoalsWidget } from './goals-widget'
import { MonthPicker } from './month-picker'

interface DashboardViewProps {
  transactions: Transaction[]
  bills: Bill[]
  billPayments: BillPayment[]
  assets: Asset[]
  debts: Debt[]
  goals: Goal[]
  budgets: Budget[]
  settings: Settings | null
  currentMonth: string
}

export function DashboardView(props: DashboardViewProps) {
  const { setTransactions, setBills, setBillPayments, setAssets, setDebts, setGoals, setBudgets, setSettings, setCurrentMonth } = useFinanceStore()

  // Hydrate store from server-fetched data
  useEffect(() => {
    setTransactions(props.transactions)
    setBills(props.bills)
    setBillPayments(props.billPayments)
    setAssets(props.assets)
    setDebts(props.debts)
    setGoals(props.goals)
    setBudgets(props.budgets)
    setSettings(props.settings)
    setCurrentMonth(props.currentMonth)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sym = props.settings?.currency_symbol ?? '£'

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Your financial overview
          </p>
        </div>
        <MonthPicker />
      </div>

      {/* KPI row */}
      <KpiCards sym={sym} />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
        {/* Left column — transactions + budgets */}
        <div className="lg:col-span-2 space-y-5">
          <RecentTransactions sym={sym} />
          <BudgetOverview sym={sym} />
        </div>

        {/* Right column — net worth, bills, goals */}
        <div className="space-y-5">
          <NetWorthCard sym={sym} />
          <BillsWidget sym={sym} />
          <GoalsWidget sym={sym} />
        </div>
      </div>
    </div>
  )
}
