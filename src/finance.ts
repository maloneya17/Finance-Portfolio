/**
 * Pure financial calculations that depend only on db + utils.
 * No imports from render or handlers — breaks the circular dep chain.
 */
import { db, persistOnly, saveCount } from './db';
import { math } from './utils';

// Month key must match YYYY-MM format with a valid month (01-12)
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isValidMonthKey(k: string): boolean { return MONTH_KEY_RE.test(k); }

// Lightweight cache — invalidated whenever saveCount changes (i.e., any save/persistOnly).
// getRollover is called 3+ times per navigation (render, renderCalendar, renderWealth);
// caching eliminates O(N × months) repeated full-history traversals.
interface RolloverCache { key: string; val: number; epoch: number; }
let _rolloverCache: RolloverCache | null = null;

export function getRollover(currentKey: string): number {
  if (_rolloverCache?.key === currentKey && _rolloverCache.epoch === saveCount) {
    return _rolloverCache.val;
  }
  let balance = 0;
  const sortedKeys = Object.keys(db.transactions).filter(isValidMonthKey).sort();
  for (const k of sortedKeys) {
    if (k >= currentKey) break;
    let mInc = 0, mExp = 0;
    (db.transactions[k] ?? []).forEach(t => {
      if (t.type === 'income') mInc += math(t.amount);
      else if (t.type === 'expense') mExp += math(t.amount);
    });
    balance += mInc - mExp;
  }
  _rolloverCache = { key: currentKey, val: balance, epoch: saveCount };
  return balance;
}

export function getCurrentCats(monthKey: string): Record<string, number> {
  const cats: Record<string, number> = {};
  (db.transactions[monthKey] ?? []).forEach(t => {
    if (t.type === 'expense') cats[t.category] = (cats[t.category] ?? 0) + math(t.amount);
  });
  return cats;
}

export function consolidateWealth(): void {
  let hasChanges = false;
  const mergedIds: string[] = [];

  const assetMap = new Map<string, typeof db.wealth.assets[0]>();
  db.wealth.assets.forEach(a => {
    const key = `${a.name.trim().toLowerCase()}|${(a.type ?? '').toLowerCase()}`;
    if (assetMap.has(key)) {
      const ex = assetMap.get(key)!;
      ex.value += math(a.value);
      // Keep the most recent updatedAt so sync doesn't overwrite the merge result
      ex.updatedAt = Math.max(ex.updatedAt ?? 0, a.updatedAt ?? 0) || Date.now();
      mergedIds.push(a.id); // tombstone the losing id so cloud doesn't resurrect it
      hasChanges = true;
    } else {
      assetMap.set(key, { ...a, value: math(a.value) });
    }
  });

  const debtMap = new Map<string, typeof db.wealth.debts[0]>();
  db.wealth.debts.forEach(d => {
    const key = d.name.trim().toLowerCase();
    if (debtMap.has(key)) {
      const ex = debtMap.get(key)!;
      ex.value += math(d.value);
      ex.updatedAt = Math.max(ex.updatedAt ?? 0, d.updatedAt ?? 0) || Date.now();
      mergedIds.push(d.id);
      hasChanges = true;
    } else {
      debtMap.set(key, { ...d, value: math(d.value) });
    }
  });

  if (hasChanges) {
    // Tombstone merged IDs so cloud sync can't resurrect the consumed duplicates
    db.deletedIds.push(...mergedIds);
    db.wealth.assets = Array.from(assetMap.values());
    db.wealth.debts = Array.from(debtMap.values());
    persistOnly();
  }
}
