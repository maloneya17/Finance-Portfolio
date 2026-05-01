'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Dashboard page error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="text-5xl mb-4" aria-hidden="true">⚠️</div>
      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Something went wrong</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm">
        An unexpected error occurred while loading this page. Your data is safe.
      </p>
      <Button onClick={reset} variant="outline">Try again</Button>
      {error.digest && (
        <p className="mt-4 text-xs text-slate-400 font-mono">Error ID: {error.digest}</p>
      )}
    </div>
  )
}
