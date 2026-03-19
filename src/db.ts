import type { AppDB } from './types';
import { DEFAULTS, SCHEMA_VERSION } from './constants';
import { showToast } from './toast';

const STORAGE_KEY = 'infinityDB';

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
  return db;
}

function repair(db: AppDB): AppDB {
  if (!db.transactions || Array.isArray(db.transactions)) db.transactions = {};
  if (!db.theme) db.theme = 'light';
  if (!db.bills) db.bills = [];
  if (!db.billStatus) db.billStatus = {};
  if (!db.wealth) db.wealth = { assets: [], debts: [], history: {} };
  if (!db.wealth.assets) db.wealth.assets = [];
  if (!db.wealth.debts) db.wealth.debts = [];
  if (!db.wealth.history) db.wealth.history = {};
  if (!db.budgets) db.budgets = {};
  if (!db.categories) db.categories = [...DEFAULTS.categories];
  if (!db.categories.includes('Imported')) db.categories.push('Imported');
  if (!db.recurring) db.recurring = [];
  if (!db.deletedIds) db.deletedIds = [];
  if (typeof db.annualIncome !== 'number') db.annualIncome = 0;
  if (!db.currency) db.currency = '£';
  if (!db.goals) db.goals = [];
  if (db.autoRecurring === undefined) db.autoRecurring = false;
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

export function save(skipRender = false): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e: unknown) {
    console.error('Persist failed:', e);
  }
}

export function clearAndReload(): void {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

export { SCHEMA_VERSION };
