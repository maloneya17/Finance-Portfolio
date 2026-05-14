import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-[rgba(0,122,255,0.1)] text-[var(--ios-blue)]',
        success:     'bg-[rgba(52,199,89,0.1)] text-[var(--ios-green)]',
        destructive: 'bg-[rgba(255,59,48,0.1)] text-[var(--ios-red)]',
        warning:     'bg-[rgba(255,149,0,0.1)] text-[var(--ios-orange)]',
        outline:     'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
        pro:         'bg-gradient-to-r from-[var(--ios-blue)] to-[var(--ios-purple)] text-white',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
