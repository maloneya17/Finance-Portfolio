'use client'

import { useState, useEffect, useRef } from 'react'
import type { Transaction, Settings } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import { MonthPicker } from '@/components/dashboard/month-picker'
import { TransactionList } from './transaction-list'
import { TransactionForm } from './transaction-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useFinanceStore } from '@/store/finance'

const PAGE_SIZE = 100

interface Props {
  transactions: Transaction[]
  settings: Settings | null
  userId: string
  isPro?: boolean
  hitLimit?: boolean
  initialCategory?: string | null
}

export function TransactionsView({ transactions, settings, userId, isPro, hitLimit, initialCategory }: Props) {
  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [hasMore, setHasMore] = useState(hitLimit ?? false)
  const [loadingMore, setLoadingMore] = useState(false)

  const { setTransactions } = useFinanceStore()
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

  async function loadMore() {
    const oldest = allTransactions.at(-1)
    if (!oldest || loadingMore) return
    setLoadingMore(true)
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .lt('date', oldest.date)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      if (data && data.length > 0) {
        setTransactions([...allTransactions, ...(data as Transaction[])])
        setHasMore(data.length === PAGE_SIZE)
      } else {
        setHasMore(false)
      }
    } finally {
      setLoadingMore(false)
    }
  }

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

      <TransactionList sym={sym} onEdit={handleEdit} userId={userId} initialCategory={initialCategory} />

      {hasMore && (
        <div className="flex justify-center mt-4">
          <Button variant="outline" size="sm" onClick={loadMore} loading={loadingMore}>
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
            {loadingMore ? 'Loading…' : 'Load older transactions'}
          </Button>
        </div>
      )}

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
