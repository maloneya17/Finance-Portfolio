'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Bill, BillInsert, BillPayment, BillPaymentUpdate, Settings } from '@/types/supabase'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, monthKeyToLabel, ordinal } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Plus, CheckCircle2, Circle, Pencil, Trash2, CalendarDays, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface Props {
  bills: Bill[]
  initialPayments: BillPayment[]
  settings: Settings | null
  userId: string
  currentMonth: string
}

export function BillsView({ bills: initBills, initialPayments, settings, userId, currentMonth }: Props) {
  const [bills, setBills]       = useState<Bill[]>(initBills)
  const [payments, setPayments] = useState<Record<string, BillPayment>>(
    Object.fromEntries(initialPayments.map(p => [p.bill_id, p]))
  )
  const [open, setOpen]         = useState(false)
  const [editing, setEditing]   = useState<Bill | null>(null)
  const [month, setMonth]       = useState(currentMonth)
  const [togglingId, setTogglingId]       = useState<string | null>(null)
  const [confirmBillId, setConfirmBillId] = useState<string | null>(null)
  const [loadingPayments, setLoadingPayments] = useState(false)
  const router                  = useRouter()
  const supabase                = useMemo(() => createClient(), [])
  const sym                     = settings?.currency_symbol ?? '£'
  const categories              = settings?.categories ?? []

  // Re-fetch payment records whenever the selected month changes
  useEffect(() => {
    setPayments({})  // clear immediately to avoid stale checkmarks from the previous month
    let cancelled = false
    async function fetchPayments() {
      setLoadingPayments(true)
      try {
        const { data } = await supabase
          .from('bill_payments')
          .select('*')
          .eq('user_id', userId)
          .eq('month_key', month)
        if (!cancelled && data) {
          setPayments(Object.fromEntries((data as BillPayment[]).map(p => [p.bill_id, p])))
        }
      } finally {
        if (!cancelled) setLoadingPayments(false)
      }
    }
    fetchPayments()
    return () => { cancelled = true }
  }, [supabase, month, userId])

  const paidIds    = new Set(Object.values(payments).filter(p => p.paid).map(p => p.bill_id))
  const totalDue   = bills.reduce((s, b) => s + b.amount, 0)
  const totalPaid  = bills.filter(b => paidIds.has(b.id)).reduce((s, b) => s + b.amount, 0)
  const totalUnpaid = totalDue - totalPaid

  async function togglePaid(bill: Bill) {
    if (togglingId === bill.id) return  // Prevent double-click
    setTogglingId(bill.id)
    try {
      const isPaid       = paidIds.has(bill.id)
      const existing     = payments[bill.id]
      const becomingPaid = !isPaid

      if (existing) {
        // Toggling an existing payment record
        if (!becomingPaid && existing.transaction_id) {
          // Soft-delete the linked transaction instead of hard-deleting
          const { error: softDelErr } = await supabase
            .from('transactions')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', existing.transaction_id)
            .eq('user_id', userId)
          if (softDelErr) console.warn('Failed to soft-delete bill payment transaction:', softDelErr.message)
        }

        const updatePayload: BillPaymentUpdate = {
          paid: !isPaid,
          updated_at: new Date().toISOString(),
          transaction_id: becomingPaid ? existing.transaction_id : null,
        }
        const { data } = await supabase.from('bill_payments').update(updatePayload).eq('id', existing.id).select().single()
        if (data) setPayments({ ...payments, [bill.id]: data as BillPayment })
      } else {
        // Single atomic RPC: bill_payment insert + transaction insert + link all
        // execute inside one DB transaction — no orphaned rows on network failure
        const txDate = (() => {
          const [year, mon] = month.split('-').map(Number)
          const lastDay = new Date(year, mon, 0).getDate()
          const day = Math.min(bill.day, lastDay)
          return `${month}-${String(day).padStart(2, '0')}`
        })()

        const { data: linked, error: rpcErr } = await supabase.rpc('mark_bill_paid', {
          p_bill_id:   bill.id,
          p_month_key: month,
          p_amount:    bill.amount,
          p_category:  bill.category || 'Bills',
          p_name:      bill.name,
          p_tx_date:   txDate,
        })
        if (rpcErr || !linked) {
          toast.error('Failed to update bill payment')
          return
        }
        setPayments({ ...payments, [bill.id]: linked as BillPayment })
      }

      router.refresh()
    } finally {
      setTogglingId(null)
    }
  }

  async function confirmDeleteBill(id: string) {
    const { error } = await supabase.from('bills').update({ is_active: false } as Partial<BillInsert>).eq('id', id)
    if (error) { toast.error('Failed to delete bill. Please try again.'); return }
    setBills(bills.filter(b => b.id !== id))
    setConfirmBillId(null)
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Bills</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{monthKeyToLabel(month)}</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }} size="sm">
          <Plus className="w-4 h-4" aria-hidden="true" /> Add Bill
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Due',    value: totalDue,    color: 'var(--ios-blue)'  },
          { label: 'Paid',         value: totalPaid,   color: 'var(--ios-green)' },
          { label: 'Outstanding',  value: totalUnpaid, color: totalUnpaid > 0 ? 'var(--ios-red)' : 'var(--ios-green)' },
        ].map(item => (
          <Card key={item.label} className="p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">{item.label}</p>
            <p className="text-xl font-bold" style={{ color: item.color }}>{formatCurrency(item.value, sym)}</p>
          </Card>
        ))}
      </div>

      {/* Progress bar */}
      {totalDue > 0 && (
        <div className="mb-6">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>{paidIds.size}/{bills.length} bills paid</span>
            <span>{((totalPaid / totalDue) * 100).toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(totalPaid / totalDue) * 100}%`, background: 'var(--ios-green)' }}
            />
          </div>
        </div>
      )}

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => {
            const [y, m] = month.split('-').map(Number)
            const prev = new Date(y, m - 2, 1)
            setMonth(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`)
          }}
          className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <span className="font-medium text-sm">
          {monthKeyToLabel(month)}
          {loadingPayments && <span className="ml-2 text-xs text-slate-400 animate-pulse">Loading…</span>}
        </span>
        <button
          onClick={() => {
            const [y, m] = month.split('-').map(Number)
            const next = new Date(y, m, 1)
            setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
          }}
          className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Bill list */}
      <Card>
        {bills.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No bills yet"
            description="Add recurring bills to track your monthly obligations."
            action={<Button variant="tint" size="sm" onClick={() => setOpen(true)}>Add your first bill</Button>}
          />
        ) : (
          <ul className="divide-y divide-slate-50 dark:divide-slate-800" role="list" aria-label="Bills">
            {bills.map(bill => {
              const paid = paidIds.has(bill.id)
              return (
                <li
                  key={bill.id}
                  className={cn('flex items-center gap-4 px-5 py-4 group transition', paid && 'opacity-60')}
                >
                  <button
                    onClick={() => togglePaid(bill)}
                    disabled={togglingId === bill.id}
                    className="shrink-0 transition"
                    aria-label={paid ? `Mark ${bill.name} unpaid` : `Mark ${bill.name} paid`}
                    aria-pressed={paid}
                  >
                    {togglingId === bill.id
                      ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden="true" />
                      : paid
                        ? <CheckCircle2 className="w-5 h-5 text-[var(--ios-green)]" aria-hidden="true" />
                        : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 hover:text-[var(--ios-blue)]" aria-hidden="true" />
                    }
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-semibold text-slate-800 dark:text-slate-100', paid && 'line-through')}>{bill.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-xs">{bill.category}</Badge>
                      <span className="text-xs text-slate-500">Due {ordinal(bill.day)}</span>
                    </div>
                  </div>

                  <span className="text-sm font-bold" style={{ color: paid ? 'var(--ios-green)' : 'var(--ios-red)' }}>
                    {formatCurrency(bill.amount, sym)}
                  </span>

                  <div className="flex gap-1 transition">
                    <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(bill); setOpen(true) }} aria-label={`Edit ${bill.name}`} className="text-slate-400 hover:text-[var(--ios-blue)]">
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setConfirmBillId(bill.id)} aria-label={`Delete ${bill.name}`} className="text-slate-400 hover:text-[var(--ios-red)]">
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Add/Edit dialog */}
      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setEditing(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Bill' : 'Add Bill'}</DialogTitle>
          </DialogHeader>
          <BillForm
            bill={editing}
            categories={categories}
            sym={sym}
            userId={userId}
            onSuccess={(bill) => {
              if (editing) setBills(bills.map(b => b.id === editing.id ? bill : b))
              else setBills([...bills, bill])
              setOpen(false)
              setEditing(null)
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmBillId !== null}
        title="Delete bill"
        description="This will permanently remove the bill and cannot be undone."
        onConfirm={() => { if (confirmBillId) confirmDeleteBill(confirmBillId) }}
        onCancel={() => setConfirmBillId(null)}
      />
    </div>
  )
}

function BillForm({ bill, categories, sym, userId, onSuccess }: {
  bill: Bill | null
  categories: string[]
  sym: string
  userId: string
  onSuccess: (bill: Bill) => void
}) {
  const supabase      = createClient()
  const submittingRef = useRef(false)
  const [name, setName]       = useState(bill?.name ?? '')
  const [amount, setAmount]   = useState(bill ? String(bill.amount) : '')
  const [day, setDay]         = useState(bill ? String(bill.day) : '1')
  const [category, setCategory] = useState(bill?.category ?? 'Bills')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setError(null)
    setLoading(true)
    try {
      // Clamp day to 28 — the safe maximum that works for all months including February
      const parsedAmount = parseFloat(amount)
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setError('Please enter a valid amount.')
        return
      }
      const payload: BillInsert = { user_id: userId, name: name.trim(), amount: parsedAmount, day: Math.min(Number(day), 28), category }
      if (bill) {
        const { data, error } = await supabase.from('bills').update(payload).eq('id', bill.id).select().single()
        if (error || !data) { setError(error?.message ?? 'Failed to save bill.'); return }
        onSuccess(data as Bill)
      } else {
        const { data, error } = await supabase.from('bills').insert(payload).select().single()
        if (error || !data) { setError(error?.message ?? 'Failed to save bill.'); return }
        onSuccess(data as Bill)
      }
    } catch {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-xl bg-[rgba(255,59,48,0.08)] border border-[rgba(255,59,48,0.2)] px-4 py-3 text-sm text-[var(--ios-red)]">{error}</div>}
      <div>
        <label htmlFor="bill-name" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Bill name</label>
        <Input id="bill-name" value={name} onChange={e => setName(e.target.value)} placeholder="Netflix, Rent, etc." required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="bill-amount" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Amount ({sym})</label>
          <Input id="bill-amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required />
        </div>
        <div>
          <label htmlFor="bill-day" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Day of month</label>
          <Input id="bill-day" type="number" min="1" max="28" value={day} onChange={e => setDay(e.target.value)} required />
        </div>
      </div>
      <div>
        <label htmlFor="bill-category" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Category</label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger id="bill-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" className="w-full" loading={loading}>{bill ? 'Update Bill' : 'Add Bill'}</Button>
    </form>
  )
}
