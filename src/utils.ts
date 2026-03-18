export const math = (v: string | number | undefined | null): number =>
  parseFloat(Number(v ?? 0).toFixed(2));

export const fmt = (n: number): string =>
  parseFloat(String(n)).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const genId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).substring(2);

export const esc = (s: string | null | undefined): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms = 200): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

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
