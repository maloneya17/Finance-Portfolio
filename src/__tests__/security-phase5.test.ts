/**
 * Phase 5 adversarial security tests.
 * Tests cover: NLP attack inputs, price API bounds, account injection,
 * instalment edge cases, digest poisoning guards, and more.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseNL } from '../nlp';
import { fetchAssetPrice, clearPriceCache, isKnownCrypto } from '../priceapi';

// ─── NLP Security Tests ───────────────────────────────────────────────────────

describe('NLP — adversarial input', () => {
  const FIXED_DATE = new Date('2025-07-15');
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FIXED_DATE); });
  afterEach(() => vi.useRealTimers());

  it('input is capped at 500 chars internally', () => {
    // 501-char input — should not throw or hang
    const long = 'a '.repeat(250) + '5'; // 501 chars
    expect(() => parseNL(long)).not.toThrow();
    const r = parseNL(long);
    // Only the first 500 chars processed; amount 5 might not be reached
    // but most importantly: no crash, no hang
    expect(typeof r.desc).toBe('string');
  });

  it('10,000-char string does not hang (ReDoS guard)', () => {
    // ReDoS probe: repeated pattern that could cause catastrophic backtracking
    const evil = 'a'.repeat(10_000);
    const start = performance.now();
    parseNL(evil);
    const elapsed = performance.now() - start;
    // Should complete in well under 500ms even in slow CI environments
    expect(elapsed).toBeLessThan(500);
  });

  it('repeated alternating chars (classic ReDoS pattern) is fast', () => {
    const evil = ('ab').repeat(200) + 'c'; // 401 chars, capped to 500
    const start = performance.now();
    parseNL(evil);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('null-byte in input does not crash', () => {
    expect(() => parseNL('coffee\x005')).not.toThrow();
  });

  it('only-whitespace input returns empty result', () => {
    const r = parseNL('   \t\n  ');
    expect(r.desc).toBe('');
    expect(r.amount).toBeNull();
  });

  it('XSS attempt in input does not execute (desc is raw string, esc() handles it)', () => {
    const r = parseNL('<img src=x onerror=alert(1)> 5');
    // Desc may contain the raw tag — render layer applies esc()
    // The important invariant: parseNL must not throw and amount must parse
    expect(r.amount).toBe(5);
    expect(() => r.desc.length).not.toThrow();
  });

  it('desc is truncated to 200 chars', () => {
    const longDesc = 'word '.repeat(60); // 300 chars
    const r = parseNL(longDesc + '5');
    expect(r.desc.length).toBeLessThanOrEqual(200);
  });

  it('unicode homoglyphs do not bypass category matching', () => {
    // Full-width 'ｒｅｎｔ' should NOT match Housing category
    const r = parseNL('ｒｅｎｔ 1200');
    expect(r.category).toBeNull();
  });

  it('null-character injection in amount does not bypass bounds', () => {
    const r = parseNL('coffee \x00999999999999');
    // After capping and processing, this should not produce a valid huge amount
    if (r.amount !== null) expect(r.amount).toBeLessThanOrEqual(1_000_000);
  });

  it('scientific notation (e.g. 1e6) is not parsed as amount', () => {
    // amtRe only matches digits with optional decimal — no 'e' allowed
    const r = parseNL('coffee 1e6');
    expect(r.amount).toBeNull();
  });

  it('Infinity literal is not parsed as amount', () => {
    const r = parseNL('coffee Infinity');
    expect(r.amount).toBeNull();
  });

  it('NaN literal is not parsed as amount', () => {
    const r = parseNL('coffee NaN');
    expect(r.amount).toBeNull();
  });

  it('negative number is not parsed as amount', () => {
    const r = parseNL('refund -50');
    expect(r.amount).toBeNull();
  });

  it('zero is not parsed as amount', () => {
    const r = parseNL('coffee 0.00');
    expect(r.amount).toBeNull();
  });

  it('1_000_001 exceeds cap — rejected as amount', () => {
    const r = parseNL('transfer 1000001');
    expect(r.amount).toBeNull();
  });

  it('1_000_000 is accepted as amount', () => {
    const r = parseNL('property purchase 1000000');
    expect(r.amount).toBe(1_000_000);
  });

  it('"netflix" does NOT match Transport category (no more "tfl" substring hit)', () => {
    const r = parseNL('netflix 9.99');
    expect(r.category).toBe('Entertainment');
    expect(r.category).not.toBe('Transport');
  });

  it('"tfl oyster" correctly matches Transport', () => {
    const r = parseNL('tfl oyster 3.50');
    expect(r.category).toBe('Transport');
  });

  it('category regex is not confused by partial word: "par" in "parking"', () => {
    // "par" alone should not trigger any category; "parking" should trigger Transport
    const rPar = parseNL('par 10');
    const rParking = parseNL('parking 10');
    expect(rParking.category).toBe('Transport');
    // "par" alone doesn't hit any full-word match
    expect(rPar.category).toBeNull();
  });

  it('"saving" matches Savings but "unsatisfying" does not', () => {
    expect(parseNL('saving 200').category).toBe('Savings');
    expect(parseNL('unsatisfying day 10').category).toBeNull();
  });

  it('"gas" matches Utilities but "gasket" does not', () => {
    expect(parseNL('gas bill 80').category).toBe('Utilities');
    expect(parseNL('gasket replacement 50').category).toBeNull();
  });

  it('income type detected even with category match that overrides', () => {
    // "salary" is in INCOME_RE; category slot is null for salary → type = income, category null
    const r = parseNL('salary 2500');
    expect(r.type).toBe('income');
  });

  it('pipe character in input does not corrupt parsing', () => {
    // Pipe was the original suggestion fingerprint delimiter — ensure no collision
    const r = parseNL('Coffee|Tea 5.00');
    expect(r.amount).toBe(5);
  });
});

// ─── Price API Security Tests ──────────────────────────────────────────────────

describe('priceapi — sanity bounds', () => {
  beforeEach(() => {
    clearPriceCache();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  async function mockFetch(body: unknown, ok = true): Promise<void> {
    vi.mocked(fetch).mockResolvedValue({
      ok,
      json: async () => body,
    } as Response);
  }

  it('rejects zero price from CoinGecko', async () => {
    await mockFetch({ bitcoin: { gbp: 0 } });
    const price = await fetchAssetPrice('BTC', '£', '');
    expect(price).toBeNull();
  });

  it('rejects negative price from CoinGecko', async () => {
    await mockFetch({ bitcoin: { gbp: -100 } });
    const price = await fetchAssetPrice('BTC', '£', '');
    expect(price).toBeNull();
  });

  it('rejects Infinity price from CoinGecko', async () => {
    await mockFetch({ bitcoin: { gbp: Infinity } });
    const price = await fetchAssetPrice('BTC', '£', '');
    expect(price).toBeNull();
  });

  it('rejects price above MAX_VALID_PRICE (1e9) from CoinGecko', async () => {
    await mockFetch({ bitcoin: { gbp: 1e10 } });
    const price = await fetchAssetPrice('BTC', '£', '');
    expect(price).toBeNull();
  });

  it('accepts a valid crypto price', async () => {
    await mockFetch({ bitcoin: { gbp: 45000 } });
    const price = await fetchAssetPrice('BTC', '£', '');
    expect(price).toBe(45000);
  });

  it('rejects zero price from Alpha Vantage', async () => {
    await mockFetch({ 'Global Quote': { '05. price': '0' } });
    const price = await fetchAssetPrice('AAPL', '£', 'testkey');
    expect(price).toBeNull();
  });

  it('rejects negative price from Alpha Vantage', async () => {
    await mockFetch({ 'Global Quote': { '05. price': '-50' } });
    const price = await fetchAssetPrice('AAPL', '£', 'testkey');
    expect(price).toBeNull();
  });

  it('rejects absurdly high price from Alpha Vantage (> 1e9)', async () => {
    await mockFetch({ 'Global Quote': { '05. price': '2000000000' } });
    const price = await fetchAssetPrice('AAPL', '£', 'testkey');
    expect(price).toBeNull();
  });

  it('accepts a valid stock price', async () => {
    await mockFetch({ 'Global Quote': { '05. price': '185.25' } });
    const price = await fetchAssetPrice('AAPL', '£', 'testkey');
    expect(price).toBe(185.25);
  });

  it('returns null when fetch throws (network error)', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network failure'));
    const price = await fetchAssetPrice('BTC', '£', '');
    expect(price).toBeNull();
  });

  it('returns null for non-ok HTTP response', async () => {
    await mockFetch({}, false);
    const price = await fetchAssetPrice('BTC', '£', '');
    expect(price).toBeNull();
  });

  it('caches valid price for 5 minutes', async () => {
    await mockFetch({ bitcoin: { gbp: 45000 } });
    const p1 = await fetchAssetPrice('BTC', '£', '');
    // Second call should hit cache — fetch not called again
    const callCount = vi.mocked(fetch).mock.calls.length;
    const p2 = await fetchAssetPrice('BTC', '£', '');
    expect(vi.mocked(fetch).mock.calls.length).toBe(callCount); // no extra fetch
    expect(p1).toBe(p2);
  });

  it('does NOT cache invalid price (poisoned response cannot linger)', async () => {
    // First call returns poisoned value
    await mockFetch({ bitcoin: { gbp: -999 } });
    const p1 = await fetchAssetPrice('BTC', '£', '');
    expect(p1).toBeNull();

    // Second call — should NOT get cached null from poisoned response
    // (it should re-fetch)
    await mockFetch({ bitcoin: { gbp: 45000 } });
    const p2 = await fetchAssetPrice('BTC', '£', '');
    expect(p2).toBe(45000); // cache miss → fresh fetch → valid price
  });

  it('requires API key for stocks — returns null without one', async () => {
    const price = await fetchAssetPrice('AAPL', '£', '');
    expect(price).toBeNull();
    // fetch should not have been called (no key → early return)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('isKnownCrypto correctly identifies BTC', () => {
    expect(isKnownCrypto('BTC')).toBe(true);
    expect(isKnownCrypto('btc')).toBe(true);
  });

  it('isKnownCrypto rejects unknown tickers', () => {
    expect(isKnownCrypto('AAPL')).toBe(false);
    expect(isKnownCrypto('')).toBe(false);
    expect(isKnownCrypto('__proto__')).toBe(false);
  });

  it('price key uses uppercase ticker — prevents case-variation cache bypass', async () => {
    await mockFetch({ bitcoin: { gbp: 45000 } });
    await fetchAssetPrice('btc', '£', '');
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    await fetchAssetPrice('BTC', '£', '');
    // Both 'btc' and 'BTC' should hit the same cache key
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
  });

  it('clearPriceCache removes all entries', async () => {
    await mockFetch({ bitcoin: { gbp: 45000 } });
    await fetchAssetPrice('BTC', '£', '');
    clearPriceCache();
    // After clear, next call should re-fetch
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    await fetchAssetPrice('BTC', '£', '');
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ─── Handlers edge-case tests (account, instalment, digest guard) ──────────

// Mock the full db module so handler tests work in isolation
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  },
  writable: true,
});

vi.mock('../toast', () => ({ showToast: vi.fn() }));
vi.mock('../render', () => ({
  renderAccounts: vi.fn(),
  renderDropdowns: vi.fn(),
  renderWealth: vi.fn(),
  render: vi.fn(),
  renderGoals: vi.fn(),
}));
vi.mock('../main', () => ({ getMonthPicker: vi.fn(() => ({ value: '2025-07' })) }));

import type { AppDB } from '../types';

const mockDb: AppDB = {
  schemaVersion: 4,
  categories: ['Food', 'Housing', 'Transport', 'Bills'],
  transactions: {},
  bills: [],
  billStatus: {},
  wealth: { assets: [], debts: [], history: {} },
  deletedIds: [],
  annualIncome: 0,
  annualIncomeUpdatedAt: 0,
  cloudURL: '',
  theme: 'light',
  budgets: {},
  recurring: [],
  currency: '£',
  goals: [],
  autoRecurring: false,
  lastAutoAppliedMonth: '',
  syncPassphrase: '',
  haptics: true,
  accounts: ['Personal'],
  instalmentPlans: [],
  weeklyDigest: false,
  lastDigestDate: '',
  alphaVantageKey: '',
  taxYearMonth: 4,
  reportingPeriod: 'calendar',
};

vi.mock('../db', () => ({
  get db() { return mockDb; },
  save: vi.fn(),
  persistOnly: vi.fn(),
}));

describe('handlers — addAccount security', () => {
  beforeEach(() => { mockDb.accounts = ['Personal']; });

  it('rejects empty account name', async () => {
    const { addAccount } = await import('../handlers');
    const { showToast } = await import('../toast');
    // Mock the DOM element
    const el = { value: '' } as HTMLInputElement;
    vi.spyOn(document, 'getElementById').mockReturnValue(el as never);
    addAccount();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('name'));
    expect(mockDb.accounts).toHaveLength(1);
  });

  it('rejects account name that already exists (case-exact)', async () => {
    const { addAccount } = await import('../handlers');
    const { showToast } = await import('../toast');
    const el = { value: 'Personal' } as HTMLInputElement;
    vi.spyOn(document, 'getElementById').mockReturnValue(el as never);
    addAccount();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('already'));
    expect(mockDb.accounts).toHaveLength(1);
  });

  it('rejects account name with only whitespace', async () => {
    const { addAccount } = await import('../handlers');
    const { showToast } = await import('../toast');
    const el = { value: '   ' } as HTMLInputElement;
    vi.spyOn(document, 'getElementById').mockReturnValue(el as never);
    addAccount();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('name'));
    expect(mockDb.accounts).toHaveLength(1);
  });

  it('truncates account name to 50 chars', async () => {
    const { addAccount } = await import('../handlers');
    const long = 'A'.repeat(100);
    const el = { value: long } as HTMLInputElement;
    vi.spyOn(document, 'getElementById').mockReturnValue(el as never);
    addAccount();
    const newAcct = mockDb.accounts.find(a => a !== 'Personal');
    expect(newAcct).toBeDefined();
    expect(newAcct!.length).toBeLessThanOrEqual(50);
  });
});

describe('handlers — createInstalment security', () => {
  beforeEach(() => {
    mockDb.transactions = {};
    mockDb.instalmentPlans = [];
  });

  it('rejects months = 0', async () => {
    const { createInstalment } = await import('../handlers');
    const { showToast } = await import('../toast');
    const elements: Record<string, { value: string }> = {
      instDesc:   { value: 'Laptop' },
      instTotal:  { value: '1200' },
      instMonths: { value: '0' },
      instStart:  { value: '2025-01' },
      instCat:    { value: 'Bills' },
      instAccount:{ value: '' },
    };
    vi.spyOn(document, 'getElementById').mockImplementation(
      (id: string) => elements[id] as unknown as HTMLElement ?? null,
    );
    createInstalment();
    expect(showToast).toHaveBeenCalled();
    expect(mockDb.instalmentPlans).toHaveLength(0);
  });

  it('rejects months = 1 (minimum is 2)', async () => {
    const { createInstalment } = await import('../handlers');
    const { showToast } = await import('../toast');
    const elements: Record<string, { value: string }> = {
      instDesc:   { value: 'Laptop' },
      instTotal:  { value: '1200' },
      instMonths: { value: '1' },
      instStart:  { value: '2025-01' },
      instCat:    { value: 'Bills' },
      instAccount:{ value: '' },
    };
    vi.spyOn(document, 'getElementById').mockImplementation(
      (id: string) => elements[id] as unknown as HTMLElement ?? null,
    );
    createInstalment();
    expect(showToast).toHaveBeenCalled();
    expect(mockDb.instalmentPlans).toHaveLength(0);
  });

  it('rejects months = 121 (maximum is 120)', async () => {
    const { createInstalment } = await import('../handlers');
    const { showToast } = await import('../toast');
    const elements: Record<string, { value: string }> = {
      instDesc:   { value: 'Laptop' },
      instTotal:  { value: '1200' },
      instMonths: { value: '121' },
      instStart:  { value: '2025-01' },
      instCat:    { value: 'Bills' },
      instAccount:{ value: '' },
    };
    vi.spyOn(document, 'getElementById').mockImplementation(
      (id: string) => elements[id] as unknown as HTMLElement ?? null,
    );
    createInstalment();
    expect(showToast).toHaveBeenCalled();
    expect(mockDb.instalmentPlans).toHaveLength(0);
  });

  it('rejects total amount = 0', async () => {
    const { createInstalment } = await import('../handlers');
    const { showToast } = await import('../toast');
    const elements: Record<string, { value: string }> = {
      instDesc:   { value: 'Laptop' },
      instTotal:  { value: '0' },
      instMonths: { value: '12' },
      instStart:  { value: '2025-01' },
      instCat:    { value: 'Bills' },
      instAccount:{ value: '' },
    };
    vi.spyOn(document, 'getElementById').mockImplementation(
      (id: string) => elements[id] as unknown as HTMLElement ?? null,
    );
    createInstalment();
    expect(showToast).toHaveBeenCalled();
    expect(mockDb.instalmentPlans).toHaveLength(0);
  });

  it('rejects invalid start month', async () => {
    const { createInstalment } = await import('../handlers');
    const { showToast } = await import('../toast');
    const elements: Record<string, { value: string }> = {
      instDesc:   { value: 'Laptop' },
      instTotal:  { value: '1200' },
      instMonths: { value: '12' },
      instStart:  { value: 'not-a-month' },
      instCat:    { value: 'Bills' },
      instAccount:{ value: '' },
    };
    vi.spyOn(document, 'getElementById').mockImplementation(
      (id: string) => elements[id] as unknown as HTMLElement ?? null,
    );
    createInstalment();
    expect(showToast).toHaveBeenCalled();
    expect(mockDb.instalmentPlans).toHaveLength(0);
  });
});

describe('handlers — saveAlphaVantageKey security', () => {
  beforeEach(() => { mockDb.alphaVantageKey = ''; });

  it('rejects empty key', async () => {
    const { saveAlphaVantageKey } = await import('../handlers');
    const { showToast } = await import('../toast');
    saveAlphaVantageKey('');
    expect(mockDb.alphaVantageKey).toBe('');
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('valid'));
  });

  it('rejects whitespace-only key', async () => {
    const { saveAlphaVantageKey } = await import('../handlers');
    const { showToast } = await import('../toast');
    saveAlphaVantageKey('   ');
    expect(mockDb.alphaVantageKey).toBe('');
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('valid'));
  });

  it('truncates key to 64 chars', async () => {
    const { saveAlphaVantageKey } = await import('../handlers');
    saveAlphaVantageKey('K'.repeat(200));
    expect(mockDb.alphaVantageKey.length).toBeLessThanOrEqual(64);
  });

  it('accepts a valid key', async () => {
    const { saveAlphaVantageKey } = await import('../handlers');
    saveAlphaVantageKey('VALID_KEY_12345');
    expect(mockDb.alphaVantageKey).toBe('VALID_KEY_12345');
  });
});

describe('handlers — saveTaxYearMonth security', () => {
  it('rejects month 0', async () => {
    const { saveTaxYearMonth } = await import('../handlers');
    const before = mockDb.taxYearMonth;
    saveTaxYearMonth(0);
    expect(mockDb.taxYearMonth).toBe(before); // unchanged
  });

  it('rejects month 13', async () => {
    const { saveTaxYearMonth } = await import('../handlers');
    const before = mockDb.taxYearMonth;
    saveTaxYearMonth(13);
    expect(mockDb.taxYearMonth).toBe(before); // unchanged
  });

  it('accepts month 1-12', async () => {
    const { saveTaxYearMonth } = await import('../handlers');
    for (let m = 1; m <= 12; m++) {
      saveTaxYearMonth(m);
      expect(mockDb.taxYearMonth).toBe(m);
    }
  });
});
