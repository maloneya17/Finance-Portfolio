'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ios-blue)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97]',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--ios-blue)] text-white shadow-[var(--shadow-ios-blue)] hover:bg-[#0069DB]',
        destructive:
          'bg-[var(--ios-red)] text-white hover:bg-red-600',
        outline:
          'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800',
        ghost:
          'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
        link:
          'text-[var(--ios-blue)] underline-offset-4 hover:underline p-0 h-auto',
        success:
          'bg-[var(--ios-green)] text-white hover:bg-green-600',
        tint:
          'bg-[rgba(0,122,255,0.1)] text-[var(--ios-blue)] hover:bg-[rgba(0,122,255,0.18)]',
      },
      size: {
        default: 'h-11 px-5 py-2.5',
        sm:      'min-h-[44px] px-3 py-2 text-xs rounded-lg',
        lg:      'h-13 px-7 py-3 text-base',
        icon:    'h-11 w-11',
        'icon-sm': 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            {children}
          </>
        ) : children}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
