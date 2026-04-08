'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Transaction } from '@/types/supabase'
import { useFinanceStore } from '@/store/finance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Plus, X } from 'lucide-react'

interface SplitRow { category: string; amount: string }

interface Props {
  categories: string[]
  sym: string
  userId: string
  editing: Transaction | null
  onSuccess: () => void
}

export function TransactionForm({ categories, sym, userId, editing, onSuccess }: Props) {
  const router   = useRouter()
  const supabase = createClient()

  const [type, setType]         = useState<'income'|'expense'>(editing?.type ?? 'expense')
  const [desc, setDesc]         = useState(editing?.description ?? '')
  const [amount, setAmount]     = useState(editing ? String(editing.amount) : '')
  const [category, setCategory] = useState(editing?.category ?? '')
  const [date, setDate]         = useState(editing?.date ?? new Date().toISOString().slice(0, 10))
  const [notes, setNotes]       = useState(editing?.notes ?? '')
  const [tags, setTags]         = useState((editing?.tags ?? []).join(', '))
  const [splits, setSplits]     = useState<SplitRow[]>(
    (editing?.splits as SplitRow[] | null)?.map((s: SplitRow) => ({ category: s.category, amount: String(s.amount) })) ?? [],
  )
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const setTransactions     = useFinanceStore(s => s.setTransactions)
  const allTransactions     = useFinanceStore(s => s.transactions)
  const hasSplits           = splits.length > 0
  const splitTotal          = splits.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const remaining           = (parseFloat(amount) || 0) - splitTotal

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount.')
      setLoading(false)
      return
    }

    const parsedSplits = hasSplits
      ? splits.filter(r => r.category && parseFloat(r.amount) > 0).map(r => ({ category: r.category, amount: parseFloat(r.amount) }))
      : null

    if (hasSplits && parsedSplits !== null) {
      if (parsedSplits.length < 2) {
        setError('Please add at least 2 valid split rows (each needs a category and amount).')
        setLoading(false)
        return
      }
      const splitSum = parsedSplits.reduce((s, r) => s + r.amount, 0)
      if (Math.abs(splitSum - parsedAmount) > 0.01) {
        setError(
          `Split amounts (${sym}${splitSum.toFixed(2)}) must add up to the total (${sym}${parsedAmount.toFixed(2)})`
        )
        setLoading(false)
        return
      }
    }

    const payload = {
      user_id:     userId,
      type,
      description: desc.trim(),
      amount:      parsedAmount,
      category:    hasSplits ? 'Split' : category,
      date,
      notes:       notes.trim() || null,
      tags:        tags.split(',').map(t => t.trim()).filter(Boolean),
      splits:      parsedSplits,
      is_recurring: false,
    }

    if (editing) {
      const { data, error } = await supabase.from('transactions').update(payload).eq('id', editing.id).select().single()
      if (error) { setError(error.message); setLoading(false); return }
      if (data) setTransactions(allTransactions.map(t => t.id === editing.id ? data : t))
    } else {
      const { data, error } = await supabase.from('transactions').insert(payload).select().single()
      if (error) { setError(error.message); setLoading(false); return }
      if (data) setTransactions([data, ...allTransactions])
    }

    router.refresh()
    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-xl bg-[rgba(255,59,48,0.08)] border border-[rgba(255,59,48,0.2)] px-4 py-3 text-sm text-[var(--ios-red)]" role="alert">
          {error}
        </div>
      )}

      {/* Type toggle */}
      <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800">
        {(['expense', 'income'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={cn(
              'flex-1 py-2 text-sm font-semibold rounded-lg transition capitalize',
              type === t
                ? t === 'expense' ? 'bg-white dark:bg-slate-900 text-[var(--ios-red)] shadow-sm' : 'bg-white dark:bg-slate-900 text-[var(--ios-green)] shadow-sm'
                : 'text-slate-400',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Description */}
      <div>
        <label htmlFor="tx-desc" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Description</label>
        <Input id="tx-desc" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Grocery shopping" required />
      </div>

      {/* Amount + Date row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="tx-amount" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
            Amount ({sym})
          </label>
          <Input id="tx-amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required />
        </div>
        <div>
          <label htmlFor="tx-date" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Date</label>
          <Input id="tx-date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </div>
      </div>

      {/* Category (hidden when splits active) */}
      {!hasSplits && (
        <div>
          <label htmlFor="tx-category" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Category</label>
          <Select value={category} onValueChange={setCategory} required>
            <SelectTrigger id="tx-category">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Split rows */}
      {hasSplits && (
        <div className="space-y-2 rounded-xl border border-slate-100 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">Split Transaction</span>
            <span className={cn('text-xs font-semibold', remaining < 0 ? 'text-[var(--ios-red)]' : 'text-[var(--ios-green)]')}>
              {sym}{remaining.toFixed(2)} remaining
            </span>
          </div>
          {splits.map((row, i) => (
            <div key={i} className="flex gap-2">
              <Select value={row.category} onValueChange={v => setSplits(s => s.map((r, j) => j === i ? { ...r, category: v } : r))}>
                <SelectTrigger className="flex-1 h-9 text-xs">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                type="number" step="0.01" min="0"
                className="w-24 h-9 text-xs"
                placeholder="0.00"
                value={row.amount}
                onChange={e => setSplits(s => s.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))}
                aria-label={`Split amount ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => setSplits(s => s.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-[var(--ios-red)] transition p-1"
                aria-label="Remove split row"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Split total indicator */}
      {hasSplits && (
        <p className={cn('text-xs font-semibold', Math.abs(splitTotal - (parseFloat(amount) || 0)) <= 0.01 ? 'text-[var(--ios-green)]' : 'text-[var(--ios-red)]')}>
          Split total: {sym}{splitTotal.toFixed(2)} / {sym}{(parseFloat(amount) || 0).toFixed(2)}
        </p>
      )}

      {/* Split / Notes row */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSplits(s => [...s, { category: '', amount: '' }])}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-slate-500 hover:text-[var(--ios-blue)] hover:border-[var(--ios-blue)] transition flex items-center gap-1"
        >
          <Plus className="w-3 h-3" aria-hidden="true" /> Add Split
        </button>
      </div>

      {/* Notes + Tags */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="tx-notes" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Notes</label>
          <Input id="tx-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional note" />
        </div>
        <div>
          <label htmlFor="tx-tags" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Tags</label>
          <Input id="tx-tags" value={tags} onChange={e => setTags(e.target.value)} placeholder="work, personal" />
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-2 pt-1">
        <Button type="submit" className="flex-1" loading={loading}>
          {editing ? 'Update Transaction' : 'Add Transaction'}
        </Button>
      </div>
    </form>
  )
}
