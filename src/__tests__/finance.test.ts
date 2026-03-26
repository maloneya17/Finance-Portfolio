/**
 * Exhaustive tests for src/finance.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppDB } from '../types';

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

// Incrementing mock saveCount so cache invalidation works correctly
let _mockSaveCount = 0;

const mockDb: AppDB = {
  schemaVersion: 4,
  categories: ['Housing', 'Food', 'Transport', 'Utilities', 'Bills', 'Imported'],
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
  save: vi.fn(() => { _mockSaveCount++; }),
  persistOnly: vi.fn(() => { _mockSaveCount++; }),
  get saveCount() { return _mockSaveCount; },
  SCHEMA_VERSION: 3,
  syncFromStorage: vi.fn(),
  clearAndReload: vi.fn(),
}));

import {
  getRollover, getCurrentCats, isValidMonthKey,
  getRecentMonthKeys, getDailyBurnRate, getMonthEndForecast,
  getCashRunway, getHealthScore,
} from '../finance';

function resetDb() {
  mockDb.transactions = {};
  mockDb.wealth = { assets: [], debts: [], history: {} };
  mockDb.budgets = {};
  mockDb.goals = [];
  mockDb.bills = [];
  mockDb.billStatus = {};
  mockDb.annualIncome = 0;
  _mockSaveCount++; // Invalidate rollover cache on each reset
}

function addTx(key: string, type: 'income' | 'expense', amount: number, category = 'Food') {
  if (!mockDb.transactions[key]) mockDb.transactions[key] = [];
  mockDb.transactions[key].push({
    id: Math.random().toString(36).slice(2),
    updatedAt: Date.now(),
    desc: 'test',
    amount,
    category,
    type,
  });
  _mockSaveCount++; // Invalidate rollover cache after mutation
}

beforeEach(resetDb);

// ─── isValidMonthKey ──────────────────────────────────────────────────────────
describe('isValidMonthKey()', () => {
  const valid = ['2024-01', '2024-12', '1999-06', '2099-11', '2025-03'];
  const invalid = ['2024-00', '2024-13', '24-01', '2024-1', '2024-001',
    '', 'abcd-ef', '2024-0a', '2024/01', '2024-01-15'];
  valid.forEach(k => it(`valid: "${k}"`, () => expect(isValidMonthKey(k)).toBe(true)));
  invalid.forEach(k => it(`invalid: "${k}"`, () => expect(isValidMonthKey(k)).toBe(false)));
});

// ─── getRollover ──────────────────────────────────────────────────────────────
describe('getRollover()', () => {
  it('returns 0 for empty db', () => expect(getRollover('2025-03')).toBe(0));

  it('accumulates surplus from two prior months', () => {
    addTx('2025-01', 'income', 3000);
    addTx('2025-01', 'expense', 1000);
    addTx('2025-02', 'income', 2000);
    addTx('2025-02', 'expense', 1500);
    expect(getRollover('2025-03')).toBe(2500);
  });

  it('does NOT include current month', () => {
    addTx('2025-03', 'income', 9999);
    expect(getRollover('2025-03')).toBe(0);
  });

  it('handles deficit (negative rollover)', () => {
    addTx('2025-01', 'expense', 5000);
    addTx('2025-01', 'income', 1000);
    expect(getRollover('2025-02')).toBe(-4000);
  });

  it('ignores invalid month keys', () => {
    mockDb.transactions['invalid-key'] = [{
      id: 'x', updatedAt: 0, desc: 'x', amount: 9999, category: 'Food', type: 'income',
    }];
    _mockSaveCount++;
    expect(getRollover('2025-03')).toBe(0);
  });

  it('correctly sums 12 months of history', () => {
    let expected = 0;
    for (let m = 1; m <= 12; m++) {
      const key = `2024-${String(m).padStart(2, '0')}`;
      addTx(key, 'income', 3000);
      addTx(key, 'expense', 2500);
      expected += 500;
    }
    expect(getRollover('2025-01')).toBe(expected);
  });

  it('handles zero amounts', () => {
    addTx('2025-01', 'income', 0);
    addTx('2025-01', 'expense', 0);
    expect(getRollover('2025-02')).toBe(0);
  });

  it('floating point within tolerance', () => {
    addTx('2025-01', 'income', 100.10);
    addTx('2025-01', 'expense', 50.05);
    expect(getRollover('2025-02')).toBeCloseTo(50.05, 1);
  });

  it('cache is invalidated after addTx', () => {
    expect(getRollover('2025-03')).toBe(0);
    addTx('2025-01', 'income', 1000);
    // cache epoch changed — must recompute
    expect(getRollover('2025-03')).toBe(1000);
  });
});

// ─── getCurrentCats ───────────────────────────────────────────────────────────
describe('getCurrentCats()', () => {
  it('returns empty object for no transactions', () =>
    expect(getCurrentCats('2025-03')).toEqual({}));

  it('only counts expenses (not income)', () => {
    addTx('2025-03', 'income', 5000, 'Food');
    addTx('2025-03', 'expense', 200, 'Food');
    expect(getCurrentCats('2025-03')).toEqual({ Food: 200 });
  });

  it('accumulates same category', () => {
    addTx('2025-03', 'expense', 100, 'Food');
    addTx('2025-03', 'expense', 50, 'Food');
    expect(getCurrentCats('2025-03').Food).toBeCloseTo(150, 1);
  });

  it('separates different categories', () => {
    addTx('2025-03', 'expense', 100, 'Food');
    addTx('2025-03', 'expense', 200, 'Housing');
    const cats = getCurrentCats('2025-03');
    expect(cats.Food).toBe(100);
    expect(cats.Housing).toBe(200);
  });

  it('honours split transactions', () => {
    if (!mockDb.transactions['2025-03']) mockDb.transactions['2025-03'] = [];
    mockDb.transactions['2025-03'].push({
      id: 'split1', updatedAt: 0, desc: 'split', amount: 100,
      category: 'Split', type: 'expense',
      splits: [{ category: 'Food', amount: 60 }, { category: 'Transport', amount: 40 }],
    });
    _mockSaveCount++;
    const cats = getCurrentCats('2025-03');
    expect(cats.Food).toBe(60);
    expect(cats.Transport).toBe(40);
    expect(cats.Split).toBeUndefined();
  });

  it('ignores future months', () => {
    addTx('2099-01', 'expense', 999, 'Food');
    expect(getCurrentCats('2025-03')).toEqual({});
  });
});

// ─── getRecentMonthKeys ───────────────────────────────────────────────────────
describe('getRecentMonthKeys()', () => {
  it('returns empty when no transactions', () =>
    expect(getRecentMonthKeys('2025-03', 3)).toEqual([]));

  it('excludes current key', () => {
    for (let m = 1; m <= 3; m++) addTx(`2025-${String(m).padStart(2, '0')}`, 'expense', 100);
    expect(getRecentMonthKeys('2025-03', 3)).not.toContain('2025-03');
  });

  it('returns at most n keys', () => {
    for (let m = 1; m <= 6; m++) addTx(`2025-${String(m).padStart(2, '0')}`, 'expense', 100);
    expect(getRecentMonthKeys('2025-07', 3).length).toBeLessThanOrEqual(3);
  });

  it('all returned keys are valid', () => {
    mockDb.transactions['bad-key'] = [];
    addTx('2025-02', 'expense', 100);
    expect(getRecentMonthKeys('2025-03', 5).every(isValidMonthKey)).toBe(true);
  });
});

// ─── getDailyBurnRate ─────────────────────────────────────────────────────────
describe('getDailyBurnRate()', () => {
  it('returns 0 for no expenses', () => expect(getDailyBurnRate('2025-03')).toBe(0));
  it('never throws', () => expect(() => getDailyBurnRate('2025-03')).not.toThrow());
  it('never returns NaN or Infinity', () => {
    addTx('2024-12', 'expense', 1_000_000);
    expect(isFinite(getDailyBurnRate('2024-12'))).toBe(true);
    expect(isNaN(getDailyBurnRate('2024-12'))).toBe(false);
  });
  it('positive for any expense', () => {
    addTx('2024-12', 'expense', 310);
    expect(getDailyBurnRate('2024-12')).toBeGreaterThan(0);
  });
});

// ─── getMonthEndForecast ──────────────────────────────────────────────────────
describe('getMonthEndForecast()', () => {
  it('returns 0 for no expenses', () => expect(getMonthEndForecast('2025-03')).toBe(0));
  it('always non-negative', () => {
    addTx('2025-01', 'income', 9999);
    expect(getMonthEndForecast('2025-01')).toBeGreaterThanOrEqual(0);
  });
  it('past month: forecast ≈ actual spend', () => {
    addTx('2024-12', 'expense', 300); // December = 31 days
    expect(getMonthEndForecast('2024-12')).toBeCloseTo(300, 0);
  });
});

// ─── getCashRunway ────────────────────────────────────────────────────────────
// NOTE: getCashRunway uses getAvgMonthlyExpense(key, 6) which looks at the
// 6 months BEFORE currentKey — not the current month itself.
describe('getCashRunway()', () => {
  it('returns Infinity when no prior expenses', () =>
    expect(getCashRunway(10000, '2025-03')).toBe(Infinity));

  it('returns 0 when netWorth <= 0 and there are prior expenses', () => {
    // Seed 3 prior months with expenses so avgExp > 0
    addTx('2024-12', 'expense', 1000);
    addTx('2024-11', 'expense', 1000);
    addTx('2024-10', 'expense', 1000);
    expect(getCashRunway(0, '2025-01')).toBe(0);
    expect(getCashRunway(-500, '2025-01')).toBe(0);
  });

  it('runway ≈ netWorth / avgMonthlyExpense', () => {
    // Seed 6 months with $1000/month expenses
    for (let m = 7; m <= 12; m++) {
      addTx(`2024-${String(m).padStart(2, '0')}`, 'expense', 1000);
    }
    // netWorth = 3000, avg = 1000/month → runway ≈ 3
    const runway = getCashRunway(3000, '2025-01');
    expect(runway).toBeCloseTo(3, 0);
  });
});

// ─── getHealthScore ───────────────────────────────────────────────────────────
describe('getHealthScore()', () => {
  it('returns 0-100 for empty db', () => {
    const s = getHealthScore('2025-03', 0);
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(100);
  });

  it('never throws', () => {
    expect(() => getHealthScore('2025-03', 0)).not.toThrow();
    expect(() => getHealthScore('2025-03', -999_999)).not.toThrow();
  });

  it('score always finite', () => {
    addTx('2025-03', 'expense', 999_999);
    expect(isFinite(getHealthScore('2025-03', -999_999).total)).toBe(true);
  });

  it('good income/expense ratio gives higher score', () => {
    addTx('2025-03', 'income', 5000);
    addTx('2025-03', 'expense', 1000);
    const good = getHealthScore('2025-03', 50000).total;

    resetDb();
    addTx('2025-03', 'income', 1000);
    addTx('2025-03', 'expense', 5000);
    const bad = getHealthScore('2025-03', -10000).total;

    expect(good).toBeGreaterThan(bad);
  });

  // 20 parameterised scenarios
  const scenarios: [number, number, number][] = [
    [0, 0, 0], [5000, 3000, 10000], [1000, 5000, -2000],
    [10000, 100, 500000], [3000, 3000, 0], [500, 5000, -50000],
    [0, 1000, 0], [10000, 0, 100000], [1234, 1234, 1234],
    [999999, 1, 999999], [1, 999999, -999999], [100, 99, 1],
    [3000, 2500, 5000], [2000, 2001, -1], [6000, 600, 60000],
    [1500, 1499, 50], [800, 799, 0], [750, 750, 750],
    [2500, 2000, 3000], [12000, 11000, 24000],
  ];
  scenarios.forEach(([inc, exp, nw], i) => {
    it(`scenario ${i + 1}: inc=${inc} exp=${exp} nw=${nw}`, () => {
      resetDb();
      if (inc) addTx('2025-03', 'income', inc);
      if (exp) addTx('2025-03', 'expense', exp);
      const score = getHealthScore('2025-03', nw).total;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });
});

// ─── Stress: 500 transactions ─────────────────────────────────────────────────
describe('stress: 500 transactions', () => {
  it('getCurrentCats handles 500 transactions', () => {
    for (let i = 0; i < 500; i++) addTx('2025-03', 'expense', Math.random() * 100, 'Food');
    expect(() => getCurrentCats('2025-03')).not.toThrow();
    expect(getCurrentCats('2025-03').Food).toBeGreaterThan(0);
  });

  it('getRollover handles 480 transactions across 12 months', () => {
    for (let m = 1; m <= 12; m++) {
      const key = `2024-${String(m).padStart(2, '0')}`;
      for (let i = 0; i < 40; i++) addTx(key, i % 2 === 0 ? 'income' : 'expense', 100);
    }
    expect(() => getRollover('2025-01')).not.toThrow();
    expect(isFinite(getRollover('2025-01'))).toBe(true);
  });
});

// ─── Budget edge cases ────────────────────────────────────────────────────────
describe('budget edge cases', () => {
  it('all categories over budget → score 0-100', () => {
    ['Housing', 'Food', 'Transport', 'Utilities'].forEach(cat => {
      mockDb.budgets[cat] = 100;
      addTx('2025-03', 'expense', 200, cat);
    });
    const score = getHealthScore('2025-03', 0).total;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('all budgets under → score > 20 with surplus income', () => {
    ['Housing', 'Food', 'Transport'].forEach(cat => {
      mockDb.budgets[cat] = 1000;
      addTx('2025-03', 'expense', 50, cat);
    });
    addTx('2025-03', 'income', 5000);
    expect(getHealthScore('2025-03', 5000).total).toBeGreaterThan(20);
  });
});
