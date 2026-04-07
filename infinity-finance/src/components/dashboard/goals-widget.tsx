'use client'

import Link from 'next/link'
import { useFinanceStore } from '@/store/finance'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatCompact, pct, clamp } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props { sym: string }

export function GoalsWidget({ sym }: Props) {
  const goals   = useFinanceStore(s => s.goals)
  const privacy = useFinanceStore(s => s.privacyMode)

  const top = goals.slice(0, 3)
  const fmt = (n: number) => privacy ? '••' : formatCompact(n, sym)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Goals</CardTitle>
          <Link href="/wealth?tab=goals" className="text-xs font-semibold flex items-center gap-1 hover:underline" style={{ color: 'var(--ios-blue)' }}>
            All goals <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {top.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No goals yet</p>
        ) : (
          <ul className="space-y-4" role="list">
            {top.map(g => {
              const p    = pct(g.current, g.target)
              const done = p >= 100
              const color = done ? 'var(--ios-green)' : p > 50 ? 'var(--ios-blue)' : 'var(--ios-orange)'

              return (
                <li key={g.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      {g.emoji && <span aria-hidden="true">{g.emoji}</span>}
                      {g.name}
                    </span>
                    <span className={cn('text-xs font-medium', privacy && 'blur-[4px]')} style={{ color }}>
                      {p.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${clamp(p, 0, 100)}%`, background: color }}
                    />
                  </div>
                  <div className={cn('flex justify-between text-[10px] text-slate-400 mt-1', privacy && 'blur-[3px]')}>
                    <span>{fmt(g.current)}</span>
                    <span>{fmt(g.target)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
