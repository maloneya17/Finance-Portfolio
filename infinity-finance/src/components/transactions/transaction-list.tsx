'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useFinanceStore } from '@/store/finance'
import { createClient } from '@/lib/supabase/client'
import type { Transaction } from '@/types/supabase'
import { formatCurrency } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Pencil, Trash2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  sym: string
  userId: string
  onEdit: (tx: Transaction) => void
}

export function TransactionList({ sym, userId, onEdit }: Props) {
  const [search, setSearch]   = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const router                  = useRouter()
  const supabase                = createClient()

  const transactions  = useFinanceStore(s => s.getMonthTransactions())
  const setTransactions = useFinanceStore(s => s.setTransactions)
  const allTransactions = useFinanceStore(s => s.transactions)
  const privacy         = useFinanceStore(s => s.privacyMode)

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
    setDeleting(id)
    const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', userId)
    if (!error) {
      setTransactions(allTransactions.filter(t => t.id !== id))
      router.refresh()
    }
    setDeleting(null)
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

      {/* Search */}
      <div className="relative">
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
                    disabled={deleting === tx.id}
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
