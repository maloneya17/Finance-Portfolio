/**
 * Tests for constants.ts DEFAULTS and isValidMonthKey
 */
import { describe, it, expect, vi } from 'vitest';

// Minimal localStorage mock
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
vi.mock('../db', () => {
  return {
    db: {
      schemaVersion: 3, categories: ['Bills','Food','Transport','Entertainment','Health','Shopping','Travel','Subscriptions','Income','Imported'],
      transactions: {}, bills: [], billStatus: {}, wealth: { assets: [], debts: [], history: {} },
      deletedIds: [], annualIncome: 0, annualIncomeUpdatedAt: 0, cloudURL: '',
      theme: 'light', budgets: {}, recurring: [], currency: '£', goals: [],
      autoRecurring: false, lastAutoAppliedMonth: '', syncPassphrase: '', haptics: true,
    },
    save: vi.fn(),
    persistOnly: vi.fn(),
    saveCount: 0,
    SCHEMA_VERSION: 3,
    syncFromStorage: vi.fn(),
    clearAndReload: vi.fn(),
  };
});

import { DEFAULTS, SCHEMA_VERSION } from '../constants';
import { isValidMonthKey } from '../finance';

describe('DEFAULTS object', () => {
  it('has all required AppDB keys', () => {
    const required = [
      'schemaVersion', 'categories', 'transactions', 'bills', 'billStatus',
      'wealth', 'deletedIds', 'annualIncome', 'annualIncomeUpdatedAt', 'cloudURL',
      'theme', 'budgets', 'recurring', 'currency', 'goals', 'autoRecurring',
      'lastAutoAppliedMonth', 'syncPassphrase', 'haptics',
    ];
    required.forEach(key => expect(DEFAULTS).toHaveProperty(key));
  });

  it('haptics defaults to true', () => expect(DEFAULTS.haptics).toBe(true));
  it('currency defaults to £', () => expect(DEFAULTS.currency).toBe('£'));
  it('theme defaults to light', () => expect(DEFAULTS.theme).toBe('light'));
  it('autoRecurring defaults to false', () => expect(DEFAULTS.autoRecurring).toBe(false));
  it('schemaVersion matches SCHEMA_VERSION', () => expect(DEFAULTS.schemaVersion).toBe(SCHEMA_VERSION));
  it('transactions is empty object', () => expect(DEFAULTS.transactions).toEqual({}));
  it('goals is empty array', () => expect(DEFAULTS.goals).toEqual([]));
  it('syncPassphrase defaults to empty string', () => expect(DEFAULTS.syncPassphrase).toBe(''));
  it('categories includes Bills', () => expect(DEFAULTS.categories).toContain('Bills'));
  it('categories includes Imported', () => expect(DEFAULTS.categories).toContain('Imported'));
});

describe('isValidMonthKey (regex)', () => {
  it('all months 01-12 are valid', () => {
    for (let m = 1; m <= 12; m++) {
      expect(isValidMonthKey(`2025-${String(m).padStart(2, '0')}`)).toBe(true);
    }
  });

  it('month 00 and 13 are invalid', () => {
    expect(isValidMonthKey('2025-00')).toBe(false);
    expect(isValidMonthKey('2025-13')).toBe(false);
  });
});
