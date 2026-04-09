'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFinanceStore } from '@/store/finance'
import { createClient } from '@/lib/supabase/client'
import type { Transaction } from '@/types/supabase'
import { formatCurrency } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Pencil, Trash2, Search, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  sym: string
  userId: string
  onEdit: (tx: Transaction) => void
  isPro?: boolean
}

export function TransactionList({ sym, userId, onEdit, isPro = false }: Props) {
  const [search, setSearch]   = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [undoItem, setUndoItem] = useState<{ id: string; tx: Transaction; timer: ReturnType<typeof setTimeout> } | null>(null)
  const router                  = useRouter()

  const transactions  = useFinanceStore(s => s.getMonthTransactions())
  const setTransactions = useFinanceStore(s => s.setTransactions)
  const allTransactions = useFinanceStore(s => s.transactions)
  const privacy         = useFinanceStore(s => s.privacyMode)

  // Clean up pending timer on unmount
  useEffect(() => {
    return () => {
      if (undoItem?.timer) clearTimeout(undoItem.timer)
    }
  }, [undoItem])

  const filtered = useMemo(() => {
    if (!search.trim()) return transactions
    const q = search.toLowerCase()
    return transactions.filter(t =>
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      (t.notes ?? '').toLowerCase().includes(q),
    )
  }, [transactions, search])

  const income   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  async function handleDelete(id: string) {
    const supabase = createClient()
    const txToDelete = allTransactions.find(t => t.id === id)
    if (!txToDelete) return

    // 1. Optimistically remove from UI
    setTransactions(allTransactions.filter(t => t.id !== id))

    // 2. Soft-delete in DB (set deleted_at, don't hard DELETE)
    const { error: deleteError } = await supabase
      .from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)

    if (deleteError) {
      // Restore on failure
      setTransactions(allTransactions)
      setError('Failed to delete transaction. Please try again.')
      return
    }

    // 3. If this transaction was linked to a bill payment, unlink it
    await supabase
      .from('bill_payments')
      .update({ paid: false, transaction_id: null })
      .eq('transaction_id', id)
      .eq('user_id', userId)

    // 4. Show undo for 8 seconds
    if (undoItem) clearTimeout(undoItem.timer)
    const timer = setTimeout(() => setUndoItem(null), 8000)
    setUndoItem({ id, tx: txToDelete, timer })
  }

  async function handleUndo() {
    if (!undoItem) return
    clearTimeout(undoItem.timer)

    const supabase = createClient()
    const { error: undoError } = await supabase
      .from('transactions')
      .update({ deleted_at: null })
      .eq('id', undoItem.id)
      .eq('user_id', userId)

    if (!undoError) {
      setTransactions([undoItem.tx, ...allTransactions])
    }
    setUndoItem(null)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Income',   value: income,            color: 'var(--ios-green)' },
          { label: 'Expenses', value: expenses,          color: 'var(--ios-red)'   },
          { label: 'Net',      value: income - expenses, color: income >= expenses ? 'var(--ios-blue)' : 'var(--ios-red)' },
        ].map(item => (
          <Card key={item.label} className="p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">{item.label}</p>
            <p className={cn('text-lg font-bold tabular-nums', privacy && 'blur-[5px]')} style={{ color: item.color }}>
              {formatCurrency(item.value, sym)}
            </p>
          </Card>
        ))}
      </div>

      {/* Search + Export toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            placeholder="Search transactions…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search transactions"
          />
        </div>

        {/* Export dropdown */}
        {isPro ? (
          <div className="relative group">
            <Button variant="outline" size="sm" className="gap-1.5" aria-haspopup="menu" aria-label="Export transactions">
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export
            </Button>
            {/* Dropdown — visible on hover/focus-within */}
            <div
              className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-10 overflow-hidden hidden group-hover:block focus-within:block"
              role="menu"
            >
              <a
                href="/api/export?format=csv"
                download
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                role="menuitem"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                CSV
              </a>
              <a
                href="/api/export?format=json"
                download
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                role="menuitem"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                JSON
              </a>
            </div>
          </div>
        ) : (
          <div className="relative group/export">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 opacity-60 cursor-not-allowed"
              disabled
              aria-label="Export transactions — Pro required"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export
            </Button>
            {/* Tooltip */}
            <div
              className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-10 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 hidden group-hover/export:block"
              role="tooltip"
            >
              Upgrade to Pro to export data
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-500" role="alert">{error}</p>
      )}

      {/* Undo toast */}
      {undoItem && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium text-white"
          style={{ background: 'var(--ios-slate, #1c1c1e)' }}
        >
          <span>Transaction deleted</span>
          <button
            onClick={handleUndo}
            className="ml-4 underline underline-offset-2 hover:no-underline"
          >
            Undo
          </button>
        </div>
      )}

      {/* List */}
      <Card>
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400 dark:text-slate-500">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
            <p className="text-sm">{search ? 'No results found' : 'No transactions this month'}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-50 dark:divide-slate-800" role="list" aria-label="Transactions">
            {filtered.map(tx => (
              <li key={tx.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 group transition">
                {/* Type indicator */}
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: tx.type === 'income' ? 'var(--ios-green)' : 'var(--ios-red)' }}
                  aria-hidden="true"
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{tx.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-400">{tx.category}</span>
                    <span className="text-slate-200 dark:text-slate-700">·</span>
                    <span className="text-xs text-slate-400">{tx.date}</span>
                    {tx.tags?.map(tag => (
                      <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                    ))}
                  </div>
                </div>

                {/* Amount */}
                <span
                  className={cn('text-sm font-semibold tabular-nums shrink-0', privacy && 'blur-[5px]')}
                  style={{ color: tx.type === 'income' ? 'var(--ios-green)' : 'var(--ios-red)' }}
                >
                  {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, sym)}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onEdit(tx)}
                    aria-label={`Edit ${tx.description}`}
                    className="text-slate-400 hover:text-[var(--ios-blue)]"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(tx.id)}
                    aria-label={`Delete ${tx.description}`}
                    className="text-slate-400 hover:text-[var(--ios-red)]"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
