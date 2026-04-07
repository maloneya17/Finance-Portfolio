import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title:       'Infinity Finance — Manage Your Money',
  description: 'Track income, expenses, bills, wealth and goals. The personal finance app built for everyone.',
  manifest:    '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Infinity Finance' },
  openGraph: {
    type:  'website',
    title: 'Infinity Finance',
    description: 'Your money, your way.',
  },
}

export const viewport: Viewport = {
  width:              'device-width',
  initialScale:       1,
  themeColor:         '#007AFF',
  colorScheme:        'light dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
        {children}
      </body>
    </html>
  )
}
