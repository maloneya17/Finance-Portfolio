import { SignupForm } from '@/components/auth/signup-form'
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create Account — Infinity Finance' }

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-[var(--shadow-ios-blue)]"
            style={{ background: 'var(--ios-blue)', transform: 'rotate(-3deg)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8" aria-hidden="true">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Infinity Finance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage your money like a pro</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-6">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Create your account</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Free forever. No credit card required.</p>
          <SignupForm />
        </div>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-6">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold" style={{ color: 'var(--ios-blue)' }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
