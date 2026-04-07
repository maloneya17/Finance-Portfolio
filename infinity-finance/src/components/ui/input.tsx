import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          type={type}
          className={cn(
            'flex h-11 w-full rounded-xl border border-slate-200 dark:border-slate-700',
            'bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-white',
            'placeholder:text-slate-400 dark:placeholder:text-slate-500',
            'transition-colors',
            'focus:outline-none focus:border-[var(--ios-blue)] focus:ring-2 focus:ring-[rgba(0,122,255,0.2)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-[var(--ios-red)] focus:border-[var(--ios-red)] focus:ring-[rgba(255,59,48,0.2)]',
            className,
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-[var(--ios-red)]" role="alert">{error}</p>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'

export { Input }
