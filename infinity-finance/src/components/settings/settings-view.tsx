'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile, Settings, SettingsInsert } from '@/types/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Crown, LogOut, Trash2, Plus, X, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  user: { id: string; email: string }
  profile: Profile | null
  settings: Settings | null
}

type Tab = 'general' | 'billing' | 'account'

const CURRENCIES = [
  { code: 'GBP', symbol: '£', label: 'British Pound (£)' },
  { code: 'USD', symbol: '$', label: 'US Dollar ($)' },
  { code: 'EUR', symbol: '€', label: 'Euro (€)' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
  { code: 'CHF', symbol: 'CHF', label: 'Swiss Franc' },
]

export function SettingsView({ user, profile, settings }: Props) {
  const searchParams                = useSearchParams()
  const initialTab                  = (searchParams.get('tab') as Tab | null) ?? 'general'
  const [tab, setTab]               = useState<Tab>(initialTab)
  const [income, setIncome]         = useState(settings?.annual_income ? String(settings.annual_income) : '')
  const [currency, setCurrency]     = useState(settings?.currency ?? 'GBP')
  const [categories, setCategories] = useState<string[]>(settings?.categories ?? [])
  const [newCat, setNewCat]         = useState('')
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showDeleteForm, setShowDeleteForm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const router   = useRouter()
  const supabase = createClient()

  function handleTabChange(newTab: Tab) {
    setTab(newTab)
    router.push(`?tab=${newTab}`, { scroll: false })
  }
  const isPro    = profile?.subscription === 'pro'

  const currencyObj = CURRENCIES.find(c => c.code === currency) ?? CURRENCIES[0]

  async function saveSettings() {
    setSaving(true)
    // Include ALL settings fields on every upsert so no field is ever reset to
    // its database default when only a subset of fields was changed.
    const settingsPayload: Required<SettingsInsert> = {
      user_id:         user.id,
      annual_income:   parseFloat(income) || 0,
      currency:        currency,
      currency_symbol: currencyObj.symbol,
      categories:      categories,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('settings').upsert(settingsPayload as any, { onConflict: 'user_id' })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    router.refresh()
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function handleDeleteAccount() {
    setDeleteError(null)
    setDeleting(true)
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        setDeleteError(data.error ?? 'Failed to delete account. Please try again.')
        setDeleting(false)
        return
      }
      await supabase.auth.signOut()
      router.push('/login')
    } catch {
      setDeleteError('An unexpected error occurred. Please try again.')
      setDeleting(false)
    }
  }

  const tabs = [
    { id: 'general' as Tab, label: 'General' },
    { id: 'billing' as Tab, label: 'Billing' },
    { id: 'account' as Tab, label: 'Account' },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{user.email}</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
            className={cn(
              'px-4 py-2 text-xs font-semibold rounded-lg transition',
              tab === t.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* General */}
      {tab === 'general' && (
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Finance Settings</CardTitle></CardHeader>
            <CardContent className="pt-0 space-y-4">
              <div>
                <label htmlFor="annual-income" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Annual Income</label>
                <Input id="annual-income" type="number" step="1" min="0" value={income} onChange={e => setIncome(e.target.value)} placeholder="Enter your annual gross income" />
              </div>
              <div>
                <label htmlFor="currency" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Currency</label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Categories</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2 mb-4">
                {categories.map(cat => (
                  <span key={cat} className="flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {cat}
                    <button
                      onClick={() => setCategories(categories.filter(c => c !== cat))}
                      className="ml-1 text-slate-400 hover:text-[var(--ios-red)] transition"
                      aria-label={`Remove ${cat}`}
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
              <form onSubmit={e => { e.preventDefault(); if (newCat.trim() && !categories.includes(newCat.trim())) { setCategories([...categories, newCat.trim()]); setNewCat('') } }} className="flex gap-2">
                <Input
                  value={newCat}
                  onChange={e => setNewCat(e.target.value)}
                  placeholder="New category name"
                  className="flex-1"
                  aria-label="New category name"
                />
                <Button type="submit" variant="outline" size="sm"><Plus className="w-4 h-4" aria-hidden="true" /></Button>
              </form>
            </CardContent>
          </Card>

          <Button onClick={saveSettings} loading={saving} className="w-full">
            {saved ? '✓ Saved!' : 'Save Settings'}
          </Button>
        </div>
      )}

      {/* Billing */}
      {tab === 'billing' && (
        <div className="space-y-5">
          {/* Current plan */}
          <Card className={isPro ? 'border-[var(--ios-blue)] border-2' : ''}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                    {isPro ? 'Pro Plan' : 'Free Plan'}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {isPro ? 'All features unlocked' : '3 months history · 1 device · core features'}
                  </p>
                </div>
                <Badge variant={isPro ? 'pro' : 'outline'} className="text-xs">
                  {isPro ? 'ACTIVE' : 'FREE'}
                </Badge>
              </div>

              {isPro ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Next billing</span>
                    <span className="font-medium">{profile?.subscription_ends_at ? new Date(profile.subscription_ends_at).toLocaleDateString() : '—'}</span>
                  </div>
                  <Button variant="outline" className="w-full mt-4" onClick={() => window.location.href = '/api/stripe/portal'}>
                    Manage Subscription
                  </Button>
                </div>
              ) : (
                <Button className="w-full mt-2" onClick={() => window.location.href = '/api/stripe/checkout'}>
                  <Crown className="w-4 h-4" aria-hidden="true" />
                  Upgrade to Pro — £4.99/mo
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Feature comparison */}
          {!isPro && (
            <Card>
              <CardContent className="p-6">
                <h3 className="font-bold text-slate-900 dark:text-white mb-4">What you get with Pro</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    'Unlimited transaction history',
                    'Advanced AI insights',
                    'Data export (CSV & JSON)',
                    'Real-time multi-device sync',
                    'Priority support',
                  ].map(feature => (
                    <div key={feature} className="flex items-center gap-2">
                      <span style={{ color: 'var(--ios-green)' }}>✓</span>
                      <span className="text-slate-600 dark:text-slate-400">{feature}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-4">Cancel anytime. Annual plan saves 33%.</p>
              </CardContent>
            </Card>
          )}

          {/* Data export */}
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold text-slate-900 dark:text-white mb-1">Export Your Data</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Download all your financial data in CSV or JSON format.
                {!isPro && <span className="ml-1">Available on Pro.</span>}
              </p>
              <div className="flex gap-3">
                {isPro ? (
                  <>
                    <a
                      href="/api/export?format=csv"
                      download
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                    >
                      <Download className="w-4 h-4" aria-hidden="true" />
                      Export as CSV
                    </a>
                    <a
                      href="/api/export?format=json"
                      download
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                    >
                      <Download className="w-4 h-4" aria-hidden="true" />
                      Export as JSON
                    </a>
                  </>
                ) : (
                  <>
                    <div className="relative group">
                      <button
                        disabled
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-semibold text-slate-400 dark:text-slate-600 cursor-not-allowed"
                        aria-disabled="true"
                      >
                        <Download className="w-4 h-4" aria-hidden="true" />
                        Export as CSV
                        <Badge variant="pro" className="text-[10px] px-1.5 py-0 ml-1">Pro</Badge>
                      </button>
                    </div>
                    <div className="relative group">
                      <button
                        disabled
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-semibold text-slate-400 dark:text-slate-600 cursor-not-allowed"
                        aria-disabled="true"
                      >
                        <Download className="w-4 h-4" aria-hidden="true" />
                        Export as JSON
                        <Badge variant="pro" className="text-[10px] px-1.5 py-0 ml-1">Pro</Badge>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Account */}
      {tab === 'account' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold text-slate-900 dark:text-white mb-4">Account</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Email</span>
                  <span className="font-medium">{user.email}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Plan</span>
                  <Badge variant={isPro ? 'pro' : 'outline'}>{isPro ? 'Pro' : 'Free'}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Sign Out
          </Button>

          {!showDeleteForm ? (
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => { setShowDeleteForm(true); setDeleteError(null) }}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              Delete Account
            </Button>
          ) : (
            <div className="rounded-xl border border-[rgba(255,59,48,0.3)] bg-[rgba(255,59,48,0.04)] p-4 space-y-3">
              <p className="text-sm font-semibold text-[var(--ios-red)]">Confirm account deletion</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                This will permanently delete all your financial data and cannot be undone. Enter your password to confirm.
              </p>
              <Input
                type="password"
                placeholder="Enter your password"
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                aria-label="Password confirmation"
                autoComplete="current-password"
              />
              {deleteError && (
                <div className="rounded-xl bg-[rgba(255,59,48,0.08)] border border-[rgba(255,59,48,0.2)] px-4 py-3 text-sm text-[var(--ios-red)]" role="alert">
                  {deleteError}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setShowDeleteForm(false); setDeletePassword(''); setDeleteError(null) }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleDeleteAccount}
                  loading={deleting}
                  disabled={deletePassword.length === 0 || deleting}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs text-slate-400 text-center">This action is permanent and cannot be undone.</p>
        </div>
      )}
    </div>
  )
}
