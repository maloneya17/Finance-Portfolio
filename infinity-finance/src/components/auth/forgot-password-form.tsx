'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function ForgotPasswordForm() {
  const [email, setEmail]       = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/update-password`,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setLoading(false)
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="rounded-xl bg-[rgba(52,199,89,0.08)] border border-[rgba(52,199,89,0.2)] px-4 py-4 text-sm text-[var(--ios-green)]" role="status">
        Check your email for a reset link
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-xl bg-[rgba(255,59,48,0.08)] border border-[rgba(255,59,48,0.2)] px-4 py-3 text-sm text-[var(--ios-red)]" role="alert">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
          Email address
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
      </div>

      <Button type="submit" className="w-full" loading={loading}>
        Send reset link
      </Button>
    </form>
  )
}
