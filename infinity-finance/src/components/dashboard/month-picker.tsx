'use client'

import { useFinanceStore } from '@/store/finance'
import { monthKeyToLabel, getMonthKey } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function MonthPicker() {
  const currentMonth  = useFinanceStore(s => s.currentMonth)
  const setCurrentMonth = useFinanceStore(s => s.setCurrentMonth)
  const isCurrentMonth  = currentMonth === getMonthKey()

  function shift(delta: number) {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta)
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" onClick={() => shift(-1)} aria-label="Previous month">
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
      </Button>

      <button
        className="px-3 py-1.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition min-w-[140px] text-center"
        onClick={() => setCurrentMonth(getMonthKey())}
        title={isCurrentMonth ? 'Current month' : 'Go to current month'}
        aria-label={isCurrentMonth ? 'Current month' : 'Go to current month'}
      >
        {monthKeyToLabel(currentMonth)}
      </button>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => shift(1)}
        disabled={isCurrentMonth}
        aria-label="Next month"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </Button>
    </div>
  )
}
