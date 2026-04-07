import { create } from 'zustand'
import type { Transaction, Bill, BillPayment, Asset, Debt, Goal, Budget, Settings } from '@/types/supabase'
import { getMonthKey } from '@/lib/utils'

interface FinanceState {
  // Data
  transactions: Transaction[]
  bills: Bill[]
  billPayments: BillPayment[]
  assets: Asset[]
  debts: Debt[]
  goals: Goal[]
  budgets: Budget[]
  settings: Settings | null

  // UI
  currentMonth: string
  privacyMode: boolean

  // Setters
  setTransactions: (t: Transaction[]) => void
  setBills:        (b: Bill[]) => void
  setBillPayments: (b: BillPayment[]) => void
  setAssets:       (a: Asset[]) => void
  setDebts:        (d: Debt[]) => void
  setGoals:        (g: Goal[]) => void
  setBudgets:      (b: Budget[]) => void
  setSettings:     (s: Settings | null) => void
  setCurrentMonth: (m: string) => void
  togglePrivacy:   () => void

  // Helpers
  getMonthTransactions: () => Transaction[]
  getIncome:  () => number
  getExpenses: () => number
  getNetWorth: () => number
}

export const useFinanceStore = create<FinanceState>((set, get) => ({
  transactions: [],
  bills: [],
  billPayments: [],
  assets: [],
  debts: [],
  goals: [],
  budgets: [],
  settings: null,
  currentMonth: getMonthKey(),
  privacyMode: false,

  setTransactions: t => set({ transactions: t }),
  setBills:        b => set({ bills: b }),
  setBillPayments: b => set({ billPayments: b }),
  setAssets:       a => set({ assets: a }),
  setDebts:        d => set({ debts: d }),
  setGoals:        g => set({ goals: g }),
  setBudgets:      b => set({ budgets: b }),
  setSettings:     s => set({ settings: s }),
  setCurrentMonth: m => set({ currentMonth: m }),
  togglePrivacy:   () => set(s => ({ privacyMode: !s.privacyMode })),

  getMonthTransactions: () => {
    const { transactions, currentMonth } = get()
    return transactions.filter(t => t.date.startsWith(currentMonth))
  },

  getIncome: () => {
    const txs = get().getMonthTransactions()
    return txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  },

  getExpenses: () => {
    const txs = get().getMonthTransactions()
    return txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  },

  getNetWorth: () => {
    const { assets, debts } = get()
    const totalAssets = assets.reduce((s, a) => s + a.value, 0)
    const totalDebts  = debts.reduce((s, d) => s + d.balance, 0)
    return totalAssets - totalDebts
  },
}))
