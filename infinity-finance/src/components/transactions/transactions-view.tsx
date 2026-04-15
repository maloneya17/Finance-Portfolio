'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import type { Transaction, Settings } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import { MonthPicker } from '@/components/dashboard/month-picker'
import { TransactionList } from './transaction-list'
import { TransactionForm } from './transaction-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getMonthKey } from '@/lib/utils'
import { useFinanceStore } from '@/store/finance'

interface Props {
  transactions: Transaction[]
  settings: Settings | null
  userId: string
  isPro?: boolean
  hitLimit?: boolean
}

export function TransactionsView({ transactions, settings, userId, isPro, hitLimit }: Props) {
  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)

  const { setTransactions, currentMonth } = useFinanceStore()
  const allTransactions = useFinanceStore(s => s.transactions)

  // Keep a ref in sync with allTransactions so the realtime handler can read
  // the current list without closing over stale state. This prevents the
  // realtime useEffect from re-running (and leaking a new WebSocket channel)
  // every time allTransactions changes.
  const transactionsRef = useRef(allTransactions)
  useEffect(() => { transactionsRef.current = allTransactions }, [allTransactions])

  useEffect(() => {
    setTransactions(transactions)
  }, [transactions, setTransactions])

  // Real-time sync: updates UI when transactions change on any device.
  // Dependency array is [userId] only — the handler reads current transactions
  // via transactionsRef to avoid recreating the channel on every state change.
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`transactions:${userId}`)
      .on(
        'postgres_changes' as const,
        {
          event: '*',
          schema: 'public',
          table: 'transactions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload
          const current = transactionsRef.current

          if (eventType === 'INSERT') {
            // Only add if not soft-deleted
            const newTx = newRow as Transaction
            if (!newTx.deleted_at) {
              setTransactions([newTx, ...current.filter(t => t.id !== newTx.id)])
            }
          } else if (eventType === 'UPDATE') {
            const updated = newRow as Transaction
            if (updated.deleted_at) {
              // Soft-deleted — remove from view
              setTransactions(current.filter(t => t.id !== updated.id))
            } else {
              setTransactions(current.map(t => t.id === updated.id ? updated : t))
            }
          } else if (eventType === 'DELETE') {
            setTransactions(current.filter(t => t.id !== (oldRow as { id: string }).id))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, setTransactions])

  const sym        = settings?.currency_symbol ?? '£'
  const categories = settings?.categories ?? []

  function handleEdit(tx: Transaction) {
    setEditing(tx)
    setOpen(true)
  }

  function handleClose() {
    setOpen(false)
    setEditing(null)
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Transactions</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Track your income and expenses</p>
        </div>
        <div className="flex items-center gap-3">
          <MonthPicker />
          <Button onClick={() => setOpen(true)} size="sm">
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>

      {!isPro && (
        <div className="mb-4">
          <Badge variant="warning">
            Showing 3 months of history. Upgrade to Pro for full history.
          </Badge>
        </div>
      )}

      {hitLimit && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 mb-4">
          Showing your most recent 500 transactions. Older transactions are stored but not displayed here.
        </div>
      )}

      <TransactionList sym={sym} onEdit={handleEdit} userId={userId} />

      <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Transaction' : 'Add Transaction'}</DialogTitle>
          </DialogHeader>
          <TransactionForm
            categories={categories}
            sym={sym}
            userId={userId}
            editing={editing}
            onSuccess={handleClose}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
