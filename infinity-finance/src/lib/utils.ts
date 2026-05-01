import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, symbol = '£', locale = 'en-GB'): string {
  // Map common currency symbols to their locale for correct formatting
  const localeMap: Record<string, string> = {
    '£': 'en-GB',
    '$': 'en-US',
    '€': 'de-DE',
    '¥': 'ja-JP',
    '₹': 'en-IN',
    'kr': 'sv-SE',
    'Fr': 'fr-CH',
    'R': 'en-ZA',
    'A$': 'en-AU',
    'C$': 'en-CA',
  }
  const resolvedLocale = localeMap[symbol] ?? locale
  return symbol + new Intl.NumberFormat(resolvedLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
}

export function formatCompact(amount: number, symbol = '£'): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${sign}${symbol}${(abs / 1_000).toFixed(1)}k`
  return `${sign}${symbol}${abs.toFixed(2)}`
}

export function getMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function monthKeyToLabel(key: string): string {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function pct(part: number, total: number): number {
  if (total === 0) return 0
  return clamp((part / total) * 100, 0, 100)
}
