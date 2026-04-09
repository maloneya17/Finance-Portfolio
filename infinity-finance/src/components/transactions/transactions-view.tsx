'use client'

import { useState, useMemo, useEffect } from 'react'
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
}

export function TransactionsView({ transactions, settings, userId, isPro }: Props) {
  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)

  const { setTransactions, currentMonth } = useFinanceStore()
  const allTransactions = useFinanceStore(s => s.transactions)

  useEffect(() => {
    setTransactions(transactions)
  }, [transactions, setTransactions])

  // Real-time sync: updates UI when transactions change on any device
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

          if (eventType === 'INSERT') {
            // Only add if not soft-deleted
            const newTx = newRow as Transaction
            if (!newTx.deleted_at) {
              setTransactions([newTx, ...allTransactions.filter(t => t.id !== newTx.id)])
            }
          } else if (eventType === 'UPDATE') {
            const updated = newRow as Transaction
            if (updated.deleted_at) {
              // Soft-deleted — remove from view
              setTransactions(allTransactions.filter(t => t.id !== updated.id))
            } else {
              setTransactions(allTransactions.map(t => t.id === updated.id ? updated : t))
            }
          } else if (eventType === 'DELETE') {
            setTransactions(allTransactions.filter(t => t.id !== (oldRow as { id: string }).id))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, allTransactions, setTransactions])

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
