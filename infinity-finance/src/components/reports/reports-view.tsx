'use client'

import { useMemo } from 'react'
import type { Transaction, Settings } from '@/types/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'

interface Props {
  transactions: Transaction[]
  settings: Settings | null
}

const CATEGORY_COLORS = [
  '#007AFF','#34C759','#FF3B30','#FF9500','#AF52DE',
  '#5AC8FA','#FF2D55','#30D158','#FF6B00','#636366',
]

export function ReportsView({ transactions, settings }: Props) {
  const sym = settings?.currency_symbol ?? '£'

  // Monthly breakdown
  const monthlyData = useMemo(() => {
    const map: Record<string, { month: string; income: number; expenses: number }> = {}
    transactions.forEach(t => {
      const key = t.date.slice(0, 7)
      if (!map[key]) map[key] = { month: key, income: 0, expenses: 0 }
      if (t.type === 'income')  map[key].income   += t.amount
      else                       map[key].expenses += t.amount
    })
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({
      ...m,
      month: new Date(m.month + '-01').toLocaleString('default', { month: 'short' }),
      net: m.income - m.expenses,
    }))
  }, [transactions])

  // Category breakdown (expenses only)
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {}
    transactions.filter(t => t.type === 'expense').forEach(t => {
      map[t.category] = (map[t.category] ?? 0) + t.amount
    })
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }))
  }, [transactions])

  // Net worth trend (cumulative) — use reduce so no variable is mutated after render
  const netTrend = useMemo(() =>
    monthlyData.reduce<Array<{ month: string; net: number }>>((acc, m) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].net : 0
      acc.push({ month: m.month, net: prev + m.net })
      return acc
    }, [])
  , [monthlyData])

  const totalIncome   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const savingsRate   = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0

  const tooltipStyle = { background: '#1e293b', border: 'none', borderRadius: 8, color: '#f1f5f9', fontSize: 12 }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reports</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Year to date financial overview</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Income',   value: totalIncome,   color: 'var(--ios-green)' },
          { label: 'Total Expenses', value: totalExpenses, color: 'var(--ios-red)'   },
          { label: 'Savings Rate',   value: null, extra: `${savingsRate.toFixed(1)}%`, color: savingsRate >= 20 ? 'var(--ios-green)' : savingsRate >= 0 ? 'var(--ios-blue)' : 'var(--ios-red)' },
        ].map(item => (
          <Card key={item.label} className="p-5 text-center">
            <p className="text-xs text-slate-500 mb-2">{item.label}</p>
            <p className="text-2xl font-bold" style={{ color: item.color }}>
              {item.extra ?? formatCurrency(item.value ?? 0, sym)}
            </p>
          </Card>
        ))}
      </div>

      {/* Income vs Expenses bar chart */}
      <Card className="mb-5">
        <CardHeader><CardTitle className="text-base">Income vs Expenses</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {monthlyData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${sym}${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCurrency(Number(v), sym)} />
                <Bar dataKey="income"   name="Income"   fill="var(--ios-green)" radius={[4,4,0,0]} />
                <Bar dataKey="expenses" name="Expenses" fill="var(--ios-red)"   radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Spending by category */}
        <Card>
          <CardHeader><CardTitle className="text-base">Spending by Category</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {categoryData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-slate-400 text-sm">No expenses yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCurrency(Number(v), sym)} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Net balance trend */}
        <Card>
          <CardHeader><CardTitle className="text-base">Running Net Balance</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {netTrend.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-slate-400 text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={netTrend} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${sym}${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCurrency(Number(v), sym)} />
                  <Line type="monotone" dataKey="net" name="Net Balance" stroke="var(--ios-blue)" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
