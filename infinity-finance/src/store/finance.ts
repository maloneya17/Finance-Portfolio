import { create } from 'zustand'
import type { Transaction, Bill, BillPayment, Asset, Debt, Goal, Budget, Settings } from '@/types/supabase'
import { getMonthKey } from '@/lib/utils'
import Decimal from 'decimal.js'

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
  setPrivacyMode:  (v: boolean) => void

  // Real-time helpers
  addTransaction:    (tx: Transaction) => void
  removeTransaction: (id: string) => void
  updateTransaction: (tx: Transaction) => void

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
  addTransaction:    tx => set(state => ({
    transactions: [tx, ...state.transactions.filter(t => t.id !== tx.id)]
  })),
  removeTransaction: id => set(state => ({
    transactions: state.transactions.filter(t => t.id !== id)
  })),
  updateTransaction: tx => set(state => ({
    transactions: state.transactions.map(t => t.id === tx.id ? tx : t)
  })),
  setBills:        b => set({ bills: b }),
  setBillPayments: b => set({ billPayments: b }),
  setAssets:       a => set({ assets: a }),
  setDebts:        d => set({ debts: d }),
  setGoals:        g => set({ goals: g }),
  setBudgets:      b => set({ budgets: b }),
  setSettings:     s => set({ settings: s }),
  setCurrentMonth: m => set({ currentMonth: m }),
  togglePrivacy:   () => set(s => ({ privacyMode: !s.privacyMode })),
  setPrivacyMode:  v => set({ privacyMode: v }),

  getMonthTransactions: () => {
    const { transactions, currentMonth } = get()
    return transactions.filter(t => t.date.startsWith(currentMonth))
  },

  getIncome: () => {
    const txs = get().getMonthTransactions()
    return txs.filter(t => t.type === 'income')
      .reduce((acc, t) => acc.plus(new Decimal(t.amount)), new Decimal(0))
      .toNumber()
  },

  getExpenses: () => {
    const txs = get().getMonthTransactions()
    return txs.filter(t => t.type === 'expense')
      .reduce((acc, t) => acc.plus(new Decimal(t.amount)), new Decimal(0))
      .toNumber()
  },

  getNetWorth: () => {
    const { assets, debts } = get()
    const totalAssets = assets.reduce((acc, a) => acc.plus(new Decimal(a.value)), new Decimal(0))
    const totalDebts  = debts.reduce((acc, d) => acc.plus(new Decimal(d.balance)), new Decimal(0))
    return totalAssets.minus(totalDebts).toNumber()
  },
}))
