import type { AppDB } from './types';
import { DEFAULTS, SCHEMA_VERSION } from './constants';
import { showToast } from './toast';

export const STORAGE_KEY = 'infinityDB';

function migrate(db: AppDB): AppDB {
  if (!db.schemaVersion) db.schemaVersion = 1;
  // v1 → v2: recurring array introduced
  if (db.schemaVersion < 2) {
    if (!db.recurring) db.recurring = [];
    db.schemaVersion = 2;
  }
  // v2 → v3: currency, goals, autoRecurring
  if (db.schemaVersion < 3) {
    if (!db.currency) db.currency = '£';
    if (!db.goals) db.goals = [];
    if (db.autoRecurring === undefined) db.autoRecurring = false;
    db.schemaVersion = 3;
  }
  // v3 → v4: accounts, instalments, digest, live prices, tax year
  if (db.schemaVersion < 4) {
    if (!Array.isArray(db.accounts)) db.accounts = ['Personal'];
    if (!Array.isArray(db.instalmentPlans)) db.instalmentPlans = [];
    if (db.weeklyDigest === undefined) db.weeklyDigest = false;
    if (!db.lastDigestDate) db.lastDigestDate = '';
    if (!db.alphaVantageKey) db.alphaVantageKey = '';
    if (typeof db.taxYearMonth !== 'number') db.taxYearMonth = 4;
    if (!db.reportingPeriod) db.reportingPeriod = 'calendar';
    db.schemaVersion = 4;
  }
  return db;
}

function repair(db: AppDB): AppDB {
  if (!db.transactions || Array.isArray(db.transactions)) db.transactions = {};
  if (!db.theme) db.theme = 'light';
  // Strict array guards — malicious backups can supply objects/null for arrays
  if (!Array.isArray(db.bills)) db.bills = [];
  if (!Array.isArray(db.recurring)) db.recurring = [];
  if (!Array.isArray(db.deletedIds)) db.deletedIds = [];
  if (!Array.isArray(db.goals)) db.goals = [];
  if (!db.billStatus || typeof db.billStatus !== 'object' || Array.isArray(db.billStatus)) db.billStatus = {};
  if (!db.wealth || typeof db.wealth !== 'object') db.wealth = { assets: [], debts: [], history: {} };
  if (!Array.isArray(db.wealth.assets)) db.wealth.assets = [];
  if (!Array.isArray(db.wealth.debts)) db.wealth.debts = [];
  if (!db.wealth.history || typeof db.wealth.history !== 'object') db.wealth.history = {};
  // Clamp wealth values to finite, non-negative numbers so arithmetic never produces ±Infinity
  db.wealth.assets = db.wealth.assets.map(a => ({
    ...a,
    value: (typeof a.value === 'number' && isFinite(a.value) && a.value >= 0) ? a.value : 0,
  }));
  db.wealth.debts = db.wealth.debts.map(d => ({
    ...d,
    value: (typeof d.value === 'number' && isFinite(d.value) && d.value >= 0) ? d.value : 0,
  }));
  // Clamp bill day to valid 1-31 range
  db.bills = db.bills.map(b => ({
    ...b,
    day: (typeof b.day === 'number' && b.day >= 1 && b.day <= 31) ? b.day : 1,
  }));
  if (!db.budgets || typeof db.budgets !== 'object' || Array.isArray(db.budgets)) db.budgets = {};
  if (!Array.isArray(db.categories)) db.categories = [...DEFAULTS.categories];
  // 'Bills' and 'Imported' are relied on by core features (bill toggles, CSV import).
  // Ensure they always exist even after a category was deleted from an old backup.
  if (!db.categories.includes('Bills')) db.categories.push('Bills');
  if (!db.categories.includes('Imported')) db.categories.push('Imported');
  if (typeof db.annualIncome !== 'number') db.annualIncome = 0;
  if (typeof db.annualIncomeUpdatedAt !== 'number') db.annualIncomeUpdatedAt = 0;
  if (!db.currency) db.currency = '£';
  if (db.autoRecurring === undefined) db.autoRecurring = false;
  if (!db.lastAutoAppliedMonth) db.lastAutoAppliedMonth = '';
  if (db.syncPassphrase === undefined) db.syncPassphrase = '';
  if (db.haptics === undefined) db.haptics = true;
  // Phase 5A-5F guards
  if (!Array.isArray(db.accounts) || db.accounts.length === 0) db.accounts = ['Personal'];
  if (!Array.isArray(db.instalmentPlans)) db.instalmentPlans = [];
  if (db.weeklyDigest === undefined) db.weeklyDigest = false;
  if (typeof db.lastDigestDate !== 'string') db.lastDigestDate = '';
  if (typeof db.alphaVantageKey !== 'string') db.alphaVantageKey = '';
  if (typeof db.taxYearMonth !== 'number' || db.taxYearMonth < 1 || db.taxYearMonth > 12) db.taxYearMonth = 4;
  if (db.reportingPeriod !== 'calendar' && db.reportingPeriod !== 'tax') db.reportingPeriod = 'calendar';
  return db;
}

function load(): AppDB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AppDB) : null;
    return repair(migrate(parsed ?? { ...DEFAULTS }));
  } catch {
    console.error('DB corrupted — resetting to defaults');
    return { ...DEFAULTS };
  }
}

export let db: AppDB = load();

/**
 * Monotonic counter incremented on every successful persist (save or persistOnly).
 * finance.ts uses this to cheaply invalidate the getRollover() cache without
 * importing a callback or creating a circular dependency.
 */
export let saveCount = 0;

export function save(skipRender = false): void {
  try {
    // Prune deletedIds to prevent unbounded growth (keep most recent 500)
    if (db.deletedIds.length > 500) db.deletedIds = db.deletedIds.slice(db.deletedIds.length - 500);
    // Strip transient render-only flags before persisting
    const toSave = { ...db, bills: db.bills.map(({ _shifted: _, ...b }) => b) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    saveCount++;
  } catch (e: unknown) {
    const err = e as DOMException;
    if (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014) {
      showToast('⚠ Storage full — data not saved. Export a backup then clear old data.');
    } else {
      console.error('Save failed:', e);
    }
    return;
  }
  if (!skipRender) {
    (window as Window & { _fpRender?: () => void })._fpRender?.();
  }
  (window as Window & { _fpUpdateCloudStatus?: () => void })._fpUpdateCloudStatus?.();
}

export function persistOnly(): void {
  try {
    const toSave = { ...db, bills: db.bills.map(({ _shifted: _, ...b }) => b) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    saveCount++;
  } catch (e: unknown) {
    console.error('Persist failed:', e);
  }
}

export function clearAndReload(): void {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

/**
 * Reload the in-memory db from localStorage in-place.
 * Called when another browser tab writes to the same storage key so this
 * tab doesn't silently overwrite the other tab's changes on next save.
 */
export function syncFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const fresh = repair(migrate(JSON.parse(raw) as AppDB));
    // Clear fields no longer present (schema changes, deletions) then merge
    (Object.keys(db) as (keyof AppDB)[]).forEach(k => {
      if (!(k in fresh)) delete (db as unknown as Record<string, unknown>)[k];
    });
    Object.assign(db, fresh);
  } catch {
    console.warn('syncFromStorage: could not reload from storage');
  }
}

export { SCHEMA_VERSION };
