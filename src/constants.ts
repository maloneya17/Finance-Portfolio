import type { AppDB } from './types';

export const SCHEMA_VERSION      = 3;
export const MAX_TX_AMOUNT       = 1_000_000;
export const MAX_DESC_LENGTH     = 200;
export const MAX_NAME_LENGTH     = 100;
export const MAX_CAT_LENGTH      = 50;
export const FIRE_MULTIPLIER     = 25;
export const FIRE_ROLLING_MONTHS = 6;
export const FIRE_DEFAULT_EXP    = 2000;
export const BUDGET_WARN_PCT     = 75;
export const CALENDAR_MAX_CHIPS  = 2;

export const DEFAULTS: AppDB = {
  schemaVersion: SCHEMA_VERSION,
  categories: ['Housing', 'Food', 'Transport', 'Utilities', 'Entertainment', 'Health', 'Savings', 'Debt', 'Bills', 'Imported'],
  transactions: {},
  bills: [],
  billStatus: {},
  wealth: { assets: [], debts: [], history: {} },
  deletedIds: [],
  annualIncome: 0,
  cloudURL: '',
  theme: 'light',
  budgets: {},
  recurring: [],
  currency: '£',
  goals: [],
  autoRecurring: false,
};
