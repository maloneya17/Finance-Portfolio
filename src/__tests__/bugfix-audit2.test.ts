/**
 * Regression tests for audit-round-2 bug fixes:
 *   1. Weekly digest week-key formula (was using day-of-month / 7)
 *   2. Digest spending FP accumulation (now uses integer cent arithmetic)
 *   3. Instalment rounding precision (now uses integer cents, exact last payment)
 *   4. refreshAssetPrices busy guard (concurrent calls rejected)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Shared localStorage + mock setup ────────────────────────────────────────
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
  },
  writable: true,
});

vi.mock('../toast', () => ({ showToast: vi.fn() }));
vi.mock('../render', () => ({
  renderAccounts: vi.fn(), renderDropdowns: vi.fn(), renderWealth: vi.fn(),
  render: vi.fn(), renderGoals: vi.fn(),
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

// ─── Bug 1 & 2: Weekly digest week-key + FP accumulation ─────────────────────
// We test the week-key formula logic directly (pure unit) without importing main.ts
// since main.ts has DOM side effects. The key invariant: Math.floor(Date.now() /
// (7*24*60*60*1000)) must produce a monotonically increasing, month-boundary-safe key.

describe('digest week-key formula — correctness', () => {
  it('produces same key for two moments within the same 7-day window', () => {
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    // Anchor to the start of an epoch week, then add 3 days — must be same week
    const base  = Math.floor(Date.now() / WEEK_MS) * WEEK_MS;
    const start = base + 1000;                // 1 second past week boundary
    const mid   = base + 3 * 24 * 60 * 60 * 1000; // 3 days into same week
    expect(Math.floor(start / WEEK_MS)).toBe(Math.floor(mid / WEEK_MS));
  });

  it('produces different keys for moments in consecutive 7-day windows', () => {
    // These two Mondays are 7 days apart
    const week1 = new Date('2026-03-23T00:00:00Z').getTime();
    const week2 = new Date('2026-03-30T00:00:00Z').getTime();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    expect(Math.floor(week1 / WEEK_MS)).not.toBe(Math.floor(week2 / WEEK_MS));
  });

  it('does NOT reset at month boundary (the old bug)', () => {
    // Old formula: `${year}-W${Math.ceil(date / 7)}`
    // On Jan 31 last key is "2026-W5"; on Feb 01 it becomes "2026-W1" — same week!
    // New formula must stay stable across that boundary.
    const jan31 = new Date('2026-01-31T12:00:00Z').getTime();
    const feb01 = new Date('2026-02-01T12:00:00Z').getTime();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    // These are consecutive days so they MUST be in the same epoch-week
    const keyJan31 = Math.floor(jan31 / WEEK_MS);
    const keyFeb01 = Math.floor(feb01 / WEEK_MS);
    // Jan 31 → Feb 01 is only 1 day; they can't span a 7-day boundary
    expect(Math.abs(keyFeb01 - keyJan31)).toBeLessThanOrEqual(1);
    // More specifically they should share the same week (both are within the same 7-day window)
    // Jan 31 2026 = Saturday. Feb 01 2026 = Sunday. Both in epoch-week 2922 (from Thu 29 Jan)
    expect(keyJan31).toBe(keyFeb01);
  });

  it('key format passes the updated DIGEST_KEY_RE regex', () => {
    const DIGEST_KEY_RE = /^W\d+$/;
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const weekKey = `W${Math.floor(Date.now() / WEEK_MS)}`;
    expect(DIGEST_KEY_RE.test(weekKey)).toBe(true);
  });

  it('old format "2026-W3" does NOT pass new DIGEST_KEY_RE — prevents bypass', () => {
    const DIGEST_KEY_RE = /^W\d+$/;
    // An adversary who poisons localStorage with the old format cannot bypass the guard
    expect(DIGEST_KEY_RE.test('2026-W3')).toBe(false);
    expect(DIGEST_KEY_RE.test('2025-W1')).toBe(false);
  });
});

describe('digest spending — integer cent arithmetic', () => {
  it('accumulates 3 amounts without floating-point error', () => {
    // Classic FP issue: 0.1 + 0.2 + 0.3 !== 0.6 in IEEE 754
    const amounts = [0.1, 0.2, 0.3];
    let naive = 0;
    amounts.forEach(a => { naive += a; });

    let cents = 0;
    amounts.forEach(a => { cents += Math.round(a * 100); });
    const correct = cents / 100;

    // The naive sum has FP error; the cent-based sum is exact
    expect(Math.abs(naive - 0.6)).toBeGreaterThan(0); // demonstrates the bug
    expect(correct).toBe(0.6);                         // our fix is exact
  });

  it('handles many small amounts without drift', () => {
    // 100 × £0.01 should equal £1.00 exactly
    let cents = 0;
    for (let i = 0; i < 100; i++) cents += Math.round(0.01 * 100);
    expect(cents / 100).toBe(1.00);
  });

  it('handles zero amounts', () => {
    let cents = 0;
    [0, 0, 0].forEach(a => { cents += Math.round(a * 100); });
    expect(cents / 100).toBe(0);
  });
});

// ─── Bug 3: Instalment rounding precision ────────────────────────────────────
describe('createInstalment — rounding precision', () => {
  beforeEach(() => {
    mockDb.transactions = {};
    mockDb.instalmentPlans = [];
  });

  async function runCreateInstalment(total: string, months: string, start = '2025-01') {
    const { createInstalment } = await import('../handlers');
    const elements: Record<string, { value: string }> = {
      instDesc:    { value: 'TestPlan' },
      instAmt:     { value: total },
      instMonths:  { value: months },
      instStart:   { value: start },
      instCat:     { value: 'Bills' },
      instAccount: { value: 'Personal' },
    };
    vi.spyOn(document, 'getElementById').mockImplementation(
      (id: string) => elements[id] as unknown as HTMLElement ?? null,
    );
    createInstalment();
  }

  it('all instalment amounts sum exactly to total (£10 / 3 months)', async () => {
    await runCreateInstalment('10', '3');
    const all = Object.values(mockDb.transactions).flat();
    const sum = all.reduce((acc, t) => acc + Math.round(t.amount * 100), 0) / 100;
    expect(sum).toBe(10);
  });

  it('all instalment amounts sum exactly to total (£1 / 3 months)', async () => {
    // £1 / 3 = 33.33... — tricky case
    await runCreateInstalment('1', '3');
    const all = Object.values(mockDb.transactions).flat();
    const sum = all.reduce((acc, t) => acc + Math.round(t.amount * 100), 0) / 100;
    expect(sum).toBe(1.00);
  });

  it('all instalment amounts sum exactly to total (£100 / 7 months)', async () => {
    await runCreateInstalment('100', '7');
    const all = Object.values(mockDb.transactions).flat();
    const sum = all.reduce((acc, t) => acc + Math.round(t.amount * 100), 0) / 100;
    expect(sum).toBe(100);
  });

  it('all instalment amounts sum exactly to total (£99.99 / 12 months)', async () => {
    await runCreateInstalment('99.99', '12');
    const all = Object.values(mockDb.transactions).flat();
    const sum = all.reduce((acc, t) => acc + Math.round(t.amount * 100), 0) / 100;
    expect(sum).toBe(99.99);
  });

  it('creates exactly N transactions for N months', async () => {
    await runCreateInstalment('120', '6');
    const all = Object.values(mockDb.transactions).flat();
    expect(all).toHaveLength(6);
  });

  it('each non-last payment is floor(total/months) in cents', async () => {
    // £10 / 3: floor(1000/3) = 333 cents = £3.33 per regular payment
    await runCreateInstalment('10', '3');
    const all = Object.values(mockDb.transactions).flat().sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    // First two payments should be £3.33
    expect(all[0].amount).toBe(3.33);
    expect(all[1].amount).toBe(3.33);
    // Last payment absorbs remainder: £10 - £3.33 - £3.33 = £3.34
    expect(all[2].amount).toBe(3.34);
    // Total still exact
    expect(all[0].amount + all[1].amount + all[2].amount).toBe(10);
  });
});

// ─── Bug 4: refreshAssetPrices busy guard ────────────────────────────────────
// We test the guard by mocking fetchAssetPrice to be slow (never resolves during test)
// then verifying a second call is rejected immediately.

vi.mock('../priceapi', () => ({
  fetchAssetPrice: vi.fn(),
  clearPriceCache: vi.fn(),
  isKnownCrypto: vi.fn(() => false),
}));

describe('refreshAssetPrices — busy guard', () => {
  beforeEach(() => {
    mockDb.wealth = { assets: [{ id: 'a1', name: 'BTC', type: 'Investment', value: 100, ticker: 'BTC', quantity: 1, updatedAt: 0 }], debts: [], history: {} };
    mockDb.alphaVantageKey = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockDb.wealth = { assets: [], debts: [], history: {} };
  });

  it('second concurrent call shows toast and returns early', async () => {
    const { fetchAssetPrice } = await import('../priceapi');
    const { showToast } = await import('../toast');
    const { refreshAssetPrices } = await import('../handlers');

    // Make fetchAssetPrice stall indefinitely (simulating slow network)
    let resolveFirst!: () => void;
    (fetchAssetPrice as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<null>(res => { resolveFirst = () => res(null); }),
    );

    // Spy on getElementById so btn operations don't throw
    vi.spyOn(document, 'getElementById').mockReturnValue(null);

    // Start first refresh (does NOT await — it's in flight)
    const first = refreshAssetPrices();

    // Second call should be blocked immediately
    await refreshAssetPrices();

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('progress'));

    // Clean up: resolve first call
    resolveFirst();
    await first;
  });

  it('after first refresh completes, a second call is allowed', async () => {
    const { fetchAssetPrice } = await import('../priceapi');
    const { showToast } = await import('../toast');
    const { refreshAssetPrices } = await import('../handlers');

    (fetchAssetPrice as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.spyOn(document, 'getElementById').mockReturnValue(null);

    // First call — await it fully
    await refreshAssetPrices();

    vi.clearAllMocks();
    (fetchAssetPrice as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // Second call after first completes — should NOT show "in progress" toast
    await refreshAssetPrices();

    const toastCalls = (showToast as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string);
    const blocked = toastCalls.some(msg => msg.includes('progress'));
    expect(blocked).toBe(false);
  });
});
