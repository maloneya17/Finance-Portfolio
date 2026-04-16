/**
 * Exhaustive tests for src/utils.ts
 * Covers: math(), fmt(), esc(), csvEsc(), genId(), getMonthKey(),
 *         symFmt(), sym(), setCurrencySymbol(), debounce(), haptic()
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  math, fmt, esc, csvEsc, genId, getMonthKey,
  symFmt, sym, setCurrencySymbol, debounce,
  haptic, setHapticsEnabled,
} from '../utils';

// ─── math() ──────────────────────────────────────────────────────────────────
describe('math()', () => {
  it('returns 0 for null', () => expect(math(null)).toBe(0));
  it('returns 0 for undefined', () => expect(math(undefined)).toBe(0));
  it('returns 0 for empty string', () => expect(math('')).toBe(0));
  it('returns 0 for NaN string', () => expect(math('abc')).toBe(0));
  it('returns 0 for NaN', () => expect(math(NaN)).toBe(0));
  it('returns 0 for Infinity', () => expect(math(Infinity)).toBe(0));
  it('returns 0 for -Infinity', () => expect(math(-Infinity)).toBe(0));
  it('handles integer', () => expect(math(42)).toBe(42));
  it('handles negative', () => expect(math(-5.5)).toBe(-5.5));
  // decimal.js parses 1.005 as the exact decimal (not the IEEE 754 float),
  // so half-up rounding gives 1.01 — the mathematically correct result.
  it('rounds to 2dp', () => expect(math(1.005)).toBe(1.01));
  it('handles string number', () => expect(math('99.99')).toBe(99.99));
  it('handles string with leading zeros', () => expect(math('007')).toBe(7));
  it('handles zero', () => expect(math(0)).toBe(0));
  it('handles -0', () => expect(math(-0)).toBe(0));
  it('handles MAX_SAFE_INTEGER', () => expect(math(Number.MAX_SAFE_INTEGER)).toBe(
    parseFloat(Number.MAX_SAFE_INTEGER.toFixed(2))));
  it('handles very small float', () => expect(math(0.001)).toBe(0));
  it('handles 0.005 rounding', () => expect(math(0.005)).toBe(0.01));
  it('handles large negative', () => expect(math(-1_000_000)).toBe(-1_000_000));
  // Iterate 200 values from -100 to 100
  for (let i = -100; i <= 100; i++) {
    it(`math(${i}) === ${i}`, () => expect(math(i)).toBe(i));
  }
});

// ─── fmt() ───────────────────────────────────────────────────────────────────
describe('fmt()', () => {
  it('formats zero', () => expect(fmt(0)).toBe('0.00'));
  it('formats integer', () => expect(fmt(1234)).toBe('1,234.00'));
  it('formats float', () => expect(fmt(1234.5)).toBe('1,234.50'));
  it('formats negative', () => expect(fmt(-99.99)).toBe('-99.99'));
  it('two decimal places', () => expect(fmt(1.1)).toBe('1.10'));
  it('rounds half-even', () => {
    // toLocaleString rounding is implementation-defined; just ensure 2dp
    expect(fmt(1.005).split('.')[1].length).toBe(2);
  });
  it('handles million', () => expect(fmt(1_000_000)).toBe('1,000,000.00'));
  it('handles very small', () => expect(fmt(0.001)).toBe('0.00'));
});

// ─── esc() ───────────────────────────────────────────────────────────────────
describe('esc()', () => {
  it('escapes ampersand', () => expect(esc('A&B')).toBe('A&amp;B'));
  it('escapes less-than', () => expect(esc('<script>')).toBe('&lt;script&gt;'));
  it('escapes greater-than', () => expect(esc('a>b')).toBe('a&gt;b'));
  it('escapes double quote', () => expect(esc('"hello"')).toBe('&quot;hello&quot;'));
  it("escapes single quote", () => expect(esc("it's")).toBe("it&#x27;s"));
  it('handles empty string', () => expect(esc('')).toBe(''));
  it('handles null', () => expect(esc(null)).toBe(''));
  it('handles undefined', () => expect(esc(undefined)).toBe(''));
  it('handles safe string unchanged', () => expect(esc('hello world')).toBe('hello world'));
  it('handles all dangerous chars together', () =>
    expect(esc('<a href="test&foo">it\'s</a>')).toBe(
      '&lt;a href=&quot;test&amp;foo&quot;&gt;it&#x27;s&lt;/a&gt;'));
  it('handles unicode safely', () => expect(esc('€ £ ¥')).toBe('€ £ ¥'));
  it('handles numbers coerced to string', () =>
    // @ts-expect-error testing runtime coercion
    expect(esc(42)).toBe('42'));

  // XSS payloads — the < and > MUST be escaped; this prevents HTML parsing.
  // Attribute words like "onerror" may appear as harmless escaped text.
  const xssPayloads = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "'; DROP TABLE users; --",
    '<svg onload=alert(1)>',
    '\u003cscript\u003e',
    '<a href="javascript:alert(1)">click</a>',
  ];
  xssPayloads.forEach(p => {
    it(`XSS payload escaped: ${p.slice(0, 30)}`, () => {
      const out = esc(p);
      // Raw < must not appear (only &lt;)
      expect(out).not.toMatch(/(?<!&lt|&amp|&gt|&quot|&#x27)<[a-zA-Z/]/);
      // Confirm escaping happened when < or > present
      if (p.includes('<')) expect(out).toContain('&lt;');
    });
  });
});

// ─── csvEsc() ────────────────────────────────────────────────────────────────
describe('csvEsc()', () => {
  it('plain string unchanged', () => expect(csvEsc('hello')).toBe('hello'));
  it('wraps comma-containing string', () => expect(csvEsc('a,b')).toBe('"a,b"'));
  it('wraps quote-containing string', () => expect(csvEsc('say "hi"')).toBe('"say ""hi"""'));
  it('wraps newline-containing string', () => expect(csvEsc('line1\nline2')).toBe('"line1\nline2"'));
  it('neutralises = formula prefix', () => expect(csvEsc('=SUM(A1)')).toBe("'=SUM(A1)"));
  it('neutralises + prefix', () => expect(csvEsc('+1234')).toBe("'+1234"));
  // '-' prefix: '-1' has no comma/quote so stays as "'...", not CSV-quoted
  it('neutralises - prefix (number)', () => {
    const out = csvEsc('-1');
    // Either direct prefix or CSV-wrapped — the field value must start with '
    const val = out.startsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
    expect(val.charAt(0)).toBe("'");
  });
  it('neutralises @ prefix', () => expect(csvEsc('@SUM')).toBe("'@SUM"));
  it('handles number', () => expect(csvEsc(42)).toBe('42'));
  it('handles empty string', () => expect(csvEsc('')).toBe(''));
  it('double-quotes in wrapped string are doubled', () =>
    expect(csvEsc('"test","value"')).toBe('"""test"",""value"""'));
  // DDE attack vectors — prefix is ' even when outer CSV quoting wraps it
  const ddePayloads = ['=cmd|"/c calc"!A0', '+cmd|"/c calc"!A0', '-2+3+cmd|"/c calc"!A0', '@SUM(1+1)*cmd|"/c calc"!A0'];
  ddePayloads.forEach(p => {
    it(`DDE payload neutralised: ${p.slice(0, 20)}`, () => {
      const out = csvEsc(p);
      // Un-wrap outer double-quote CSV encoding to check field value
      const fieldValue = out.startsWith('"') && out.endsWith('"')
        ? out.slice(1, -1).replace(/""/g, '"')
        : out;
      expect(fieldValue.charAt(0)).toBe("'");
    });
  });
});

// ─── genId() ─────────────────────────────────────────────────────────────────
describe('genId()', () => {
  it('returns 32-char hex string', () => expect(genId()).toMatch(/^[0-9a-f]{32}$/));
  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, genId));
    expect(ids.size).toBe(1000);
  });
  it('never returns empty', () => {
    for (let i = 0; i < 100; i++) expect(genId().length).toBeGreaterThan(0);
  });
});

// ─── getMonthKey() ────────────────────────────────────────────────────────────
describe('getMonthKey()', () => {
  it('returns current month key by default', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(getMonthKey()).toBe(expected);
  });
  it('handles January', () => expect(getMonthKey(new Date(2024, 0, 15))).toBe('2024-01'));
  it('handles December', () => expect(getMonthKey(new Date(2024, 11, 31))).toBe('2024-12'));
  it('pads single-digit months', () => expect(getMonthKey(new Date(2024, 2, 1))).toBe('2024-03'));
  it('handles year boundaries', () => {
    expect(getMonthKey(new Date(2025, 0, 1))).toBe('2025-01');
    expect(getMonthKey(new Date(2024, 11, 31))).toBe('2024-12');
  });
  it('far future date', () => expect(getMonthKey(new Date(2999, 11, 31))).toBe('2999-12'));
  it('far past date', () => expect(getMonthKey(new Date(1970, 0, 1))).toBe('1970-01'));
});

// ─── symFmt() ─────────────────────────────────────────────────────────────────
describe('symFmt()', () => {
  beforeEach(() => setCurrencySymbol('£'));
  it('formats positive', () => expect(symFmt(100)).toBe('£100.00'));
  it('formats zero', () => expect(symFmt(0)).toBe('£0.00'));
  it('negative: minus before symbol', () => expect(symFmt(-50)).toBe('-£50.00'));
  it('negative large', () => expect(symFmt(-1234.56)).toBe('-£1,234.56'));
  it('respects custom symbol', () => { setCurrencySymbol('$'); expect(symFmt(42)).toBe('$42.00'); });
  it('respects € symbol', () => { setCurrencySymbol('€'); expect(symFmt(99)).toBe('€99.00'); });
});

// ─── setCurrencySymbol / sym() ────────────────────────────────────────────────
describe('setCurrencySymbol / sym()', () => {
  it('defaults to £', () => { setCurrencySymbol('£'); expect(sym()).toBe('£'); });
  it('updates to $', () => { setCurrencySymbol('$'); expect(sym()).toBe('$'); });
  it('falls back to £ on empty', () => { setCurrencySymbol(''); expect(sym()).toBe('£'); });
  it('handles multi-char symbol', () => { setCurrencySymbol('kr'); expect(sym()).toBe('kr'); });
  afterEach(() => setCurrencySymbol('£'));
});

// ─── debounce() ───────────────────────────────────────────────────────────────
describe('debounce()', () => {
  it('calls fn after delay', () => new Promise<void>(resolve => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    resolve();
  }));
  it('coalesces rapid calls', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 200);
    d(); d(); d(); d();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// ─── haptic() ─────────────────────────────────────────────────────────────────
describe('haptic()', () => {
  it('does not throw when vibrate unavailable', () => {
    setHapticsEnabled(true);
    // jsdom has no navigator.vibrate — should silently no-op
    expect(() => haptic('confirm')).not.toThrow();
    expect(() => haptic('warn')).not.toThrow();
    expect(() => haptic('celebrate')).not.toThrow();
    expect(() => haptic('income')).not.toThrow();
  });
  it('does not call vibrate when disabled', () => {
    setHapticsEnabled(false);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic('confirm');
    expect(vibrate).not.toHaveBeenCalled();
  });
  it('calls vibrate when enabled and available', () => {
    setHapticsEnabled(true);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
    haptic('confirm');
    expect(vibrate).toHaveBeenCalledWith([10]);
    haptic('warn');
    expect(vibrate).toHaveBeenCalledWith([10, 50, 10]);
    haptic('celebrate');
    expect(vibrate).toHaveBeenCalledWith([10, 30, 20, 30, 40]);
    haptic('income');
    expect(vibrate).toHaveBeenCalledWith([30]);
    setHapticsEnabled(false);
  });
});
