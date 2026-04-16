import Decimal from 'decimal.js'

export const math = (v: string | number | undefined | null): number => {
  try {
    const d = new Decimal(v ?? 0)
    if (!d.isFinite()) return 0
    const result = d.toDecimalPlaces(2).toNumber()
    // Normalize -0 → 0
    return result === 0 ? 0 : result
  } catch {
    return 0
  }
}

// Safe accumulator — avoids floating-point drift in reduce() chains
export const sumDecimals = (...values: (number | string | null | undefined)[]): number =>
  values.reduce<Decimal>((acc, v) => {
    try { return acc.plus(new Decimal(v ?? 0)) } catch { return acc }
  }, new Decimal(0)).toNumber()

export const fmt = (n: number): string =>
  parseFloat(String(n)).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Cryptographically secure random ID — 16 random bytes → 32-char hex string.
// Avoids Math.random() (predictable PRNG) and timestamp-based prefixes.
export const genId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

export const esc = (s: string | null | undefined): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

// ─── Haptic feedback ──────────────────────────────────────────────────────────
type HapticPattern = 'confirm' | 'warn' | 'celebrate' | 'income';
const HAPTIC_PATTERNS: Record<HapticPattern, number[]> = {
  confirm:   [10],
  warn:      [10, 50, 10],
  celebrate: [10, 30, 20, 30, 40],
  income:    [30],
};
let _hapticsEnabled = true;
export const setHapticsEnabled = (v: boolean): void => { _hapticsEnabled = v; };
export function haptic(pattern: HapticPattern): void {
  if (!_hapticsEnabled || !('vibrate' in navigator)) return;
  navigator.vibrate(HAPTIC_PATTERNS[pattern]);
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms = 200): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

// ─── Currency symbol ──────────────────────────────────────────────────────────
let _sym = '£';
export const setCurrencySymbol = (s: string): void => { _sym = s || '£'; };
export const sym = (): string => _sym;

const CAT_COLOURS: Record<string, string> = {
  Housing: '#3b82f6',
  Food: '#f59e0b',
  Transport: '#06b6d4',
  Utilities: '#eab308',
  Entertainment: '#8b5cf6',
  Health: '#10b981',
  Savings: '#6366f1',
  Bills: '#64748b',
};

export function getCatColor(c: string): string {
  if (CAT_COLOURS[c]) return CAT_COLOURS[c];
  let hash = 0;
  for (let i = 0; i < c.length; i++) hash = c.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 70%, 50%)`;
}

export function getMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format a value with the currency symbol, correctly placing the minus sign
 * before the symbol for negative values: "-£100.00" not "£-100.00".
 */
export const symFmt = (n: number): string =>
  n < 0 ? `-${sym()}${fmt(Math.abs(n))}` : `${sym()}${fmt(n)}`;

/** Escape a value for CSV output — quotes fields containing commas, quotes, or newlines.
 *  Also prefixes formula-starting characters (=, +, -, @) to prevent CSV injection. */
export function csvEsc(s: string | number): string {
  let str = String(s ?? '');
  // Neutralise formula injection (Excel, LibreOffice, Google Sheets)
  if (str.length > 0 && ['=', '+', '-', '@', '\t', '\r'].includes(str[0])) {
    str = "'" + str;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
