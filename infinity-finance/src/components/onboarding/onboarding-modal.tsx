'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const CURRENCIES = [
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
]

interface Props {
  userId: string
}

export function OnboardingModal({ userId }: Props) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('GBP')
  const [saving, setSaving] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleFinish() {
    setError(null)
    setSaving(true)
    try {
      const selected = CURRENCIES.find(c => c.code === currency) ?? CURRENCIES[0]
      const results = await Promise.all([
        supabase.from('profiles').update({ username: name || null }).eq('id', userId),
        supabase.from('settings').upsert({
          user_id: userId,
          currency: selected.code,
          currency_symbol: selected.symbol,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
      ])
      if (results.some(r => r.error)) return
      setCompleted(true)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (completed) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        {step === 1 && (
          <>
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">👋</div>
              <h2 className="text-xl font-bold">Welcome to Infinity Finance</h2>
              <p className="text-sm text-muted-foreground mt-1">Let&apos;s get you set up in 2 steps.</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5" htmlFor="onboard-name">
                  What should we call you? <span className="text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="onboard-name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <button
                onClick={() => setStep(2)}
                className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Continue →
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">💰</div>
              <h2 className="text-xl font-bold">Choose your currency</h2>
              <p className="text-sm text-muted-foreground mt-1">This can be changed later in Settings.</p>
            </div>
            <div className="space-y-2 mb-6">
              {CURRENCIES.map(c => (
                <button
                  key={c.code}
                  onClick={() => setCurrency(c.code)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    currency === c.code
                      ? 'border-primary bg-primary/5 font-medium'
                      : 'border-input hover:bg-muted'
                  }`}
                >
                  <span className="text-base w-6 text-center">{c.symbol}</span>
                  <span className="flex-1 text-left">{c.name}</span>
                  <span className="text-muted-foreground">{c.code}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep(1)}
                className="flex-1 rounded-md border py-2.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleFinish}
                disabled={saving}
                className="flex-1 rounded-md bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Setting up...' : 'Get Started 🚀'}
              </button>
            </div>
            {error && (
              <p className="text-sm text-[var(--ios-red)] text-center mt-2">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
