/**
 * Pure financial calculations that depend only on db + utils.
 * No imports from render or handlers — breaks the circular dep chain.
 */
import { db, persistOnly } from './db';
import { math } from './utils';

export function getRollover(currentKey: string): number {
  let balance = 0;
  const sortedKeys = Object.keys(db.transactions).sort();
  for (const k of sortedKeys) {
    if (k >= currentKey) break;
    let mInc = 0, mExp = 0;
    (db.transactions[k] ?? []).forEach(t => {
      if (t.type === 'income') mInc += math(t.amount);
      else if (t.type === 'expense') mExp += math(t.amount);
    });
    balance += mInc - mExp;
  }
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

  const assetMap = new Map<string, typeof db.wealth.assets[0]>();
  db.wealth.assets.forEach(a => {
    const key = `${a.name.trim().toLowerCase()}|${(a.type ?? '').toLowerCase()}`;
    if (assetMap.has(key)) {
      assetMap.get(key)!.value += parseFloat(String(a.value));
      hasChanges = true;
    } else {
      assetMap.set(key, { ...a, value: parseFloat(String(a.value)) });
    }
  });

  const debtMap = new Map<string, typeof db.wealth.debts[0]>();
  db.wealth.debts.forEach(d => {
    const key = d.name.trim().toLowerCase();
    if (debtMap.has(key)) {
      debtMap.get(key)!.value += parseFloat(String(d.value));
      hasChanges = true;
    } else {
      debtMap.set(key, { ...d, value: parseFloat(String(d.value)) });
    }
  });

  if (hasChanges) {
    db.wealth.assets = Array.from(assetMap.values());
    db.wealth.debts = Array.from(debtMap.values());
    persistOnly();
  }
}
