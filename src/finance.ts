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

// ─── Analytics & Insights calculations ────────────────────────────────────────

/**
 * Returns up to n valid month keys strictly before beforeKey, sorted ascending.
 * Used for rolling averages and trend calculations.
 */
export function getRecentMonthKeys(beforeKey: string, n: number): string[] {
  return Object.keys(db.transactions)
    .filter(k => isValidMonthKey(k) && k < beforeKey)
    .sort()
    .slice(-n);
}

/** Average monthly spend per category over the supplied month keys. */
function avgCatsOverKeys(keys: string[]): Record<string, number> {
  if (keys.length === 0) return {};
  const totals: Record<string, number> = {};
  keys.forEach(k => {
    (db.transactions[k] ?? []).forEach(t => {
      if (t.type === 'expense')
        totals[t.category] = (totals[t.category] ?? 0) + math(t.amount);
    });
  });
  const result: Record<string, number> = {};
  Object.keys(totals).forEach(c => { result[c] = math(totals[c] / keys.length); });
  return result;
}

export interface VelocityEntry {
  category: string;
  current: number;  // this month's spend
  avg: number;      // 3-month rolling average
  diff: number;     // current − avg
  pct: number;      // % change vs avg; 100 if avg=0 but current>0
}

/**
 * Spending velocity: current-month per-category totals vs 3-month rolling
 * average. Sorted by current-month spend descending.
 */
export function getSpendingVelocity(currentKey: string): VelocityEntry[] {
  const recentKeys = getRecentMonthKeys(currentKey, 3);
  const avgCats    = avgCatsOverKeys(recentKeys);
  const curCats    = getCurrentCats(currentKey);
  const allCats    = new Set([...Object.keys(curCats), ...Object.keys(avgCats)]);

  const entries: VelocityEntry[] = [];
  allCats.forEach(c => {
    const current = curCats[c] ?? 0;
    const avg     = avgCats[c] ?? 0;
    const diff    = math(current - avg);
    const pct     = avg > 0 ? math(((current - avg) / avg) * 100)
                            : (current > 0 ? 100 : 0);
    entries.push({ category: c, current, avg, diff, pct });
  });
  return entries.sort((a, b) => b.current - a.current);
}

/** How many days of the month have elapsed (all days for past months). */
function daysElapsedInMonth(monthKey: string): number {
  const now = new Date();
  const [y, m] = monthKey.split('-').map(Number);
  const isCurrentMonth = now.getFullYear() === y && now.getMonth() + 1 === m;
  return isCurrentMonth ? now.getDate() : new Date(y, m, 0).getDate();
}

/** Average daily expense so far this month (or whole month if in the past). */
export function getDailyBurnRate(monthKey: string): number {
  const exp = (db.transactions[monthKey] ?? [])
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + math(t.amount), 0);
  return math(exp / Math.max(1, daysElapsedInMonth(monthKey)));
}

/** Projected total month spend at the current daily burn rate. */
export function getMonthEndForecast(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  return math(getDailyBurnRate(monthKey) * new Date(y, m, 0).getDate());
}

/** Average monthly expense across the last `months` complete months. */
export function getAvgMonthlyExpense(currentKey: string, months = 3): number {
  const keys = getRecentMonthKeys(currentKey, months);
  if (keys.length === 0) return 0;
  const total = keys.reduce(
    (s, k) => s + (db.transactions[k] ?? [])
      .filter(t => t.type === 'expense')
      .reduce((ss, t) => ss + math(t.amount), 0),
    0,
  );
  return math(total / keys.length);
}

/**
 * Cash runway: how many months the given net worth can sustain current spending.
 * Returns Infinity when average expense is zero.
 */
export function getCashRunway(netWorth: number, currentKey: string): number {
  const avg = getAvgMonthlyExpense(currentKey, 6);
  return avg > 0 ? math(netWorth / avg) : Infinity;
}

export interface DebtPayoff {
  id: string;
  name: string;
  balance: number;
  annualRate: number;      // APR %
  monthlyPayment: number;
  monthsToPayoff: number;  // −1 = "never at this payment level"
  totalInterest: number;
  payoffDateStr: string;
}

/**
 * Amortisation-based payoff projection for every debt with a positive balance.
 * Sorted avalanche-style: highest APR first.
 */
export function getDebtPayoffPlans(): DebtPayoff[] {
  return db.wealth.debts
    .filter(d => math(d.value) > 0)
    .map(debt => {
      const balance     = math(debt.value);
      const annualRate  = math(debt.interestRate ?? 0);
      const monthlyRate = annualRate / 100 / 12;
      const minPay      = math(debt.minPayment ?? 0);

      let monthlyPayment: number;
      let monthsToPayoff: number;
      let totalInterest: number;

      if (monthlyRate <= 0) {
        // Interest-free — simple division
        monthlyPayment = minPay > 0 ? minPay : balance;
        monthsToPayoff = minPay > 0 ? Math.ceil(balance / minPay) : 1;
        totalInterest  = 0;
      } else if (minPay > 0 && minPay <= monthlyRate * balance) {
        // Payment doesn't cover interest — will never fully pay off
        monthlyPayment = minPay;
        monthsToPayoff = -1;
        totalInterest  = -1;
      } else {
        // Standard amortisation formula
        monthlyPayment = minPay > 0 ? minPay : math(monthlyRate * balance * 1.1);
        monthsToPayoff = Math.ceil(
          -Math.log(1 - (balance * monthlyRate) / monthlyPayment) /
           Math.log(1 + monthlyRate),
        );
        totalInterest  = math(monthlyPayment * monthsToPayoff - balance);
      }

      let payoffDateStr: string;
      if (monthsToPayoff <= 0) {
        payoffDateStr = 'Never — increase payment';
      } else {
        const payDate = new Date();
        payDate.setMonth(payDate.getMonth() + monthsToPayoff);
        payoffDateStr = payDate.toLocaleDateString('default', { month: 'short', year: 'numeric' });
      }

      return {
        id: debt.id,
        name: debt.name,
        balance,
        annualRate,
        monthlyPayment,
        monthsToPayoff,
        totalInterest,
        payoffDateStr,
      };
    })
    .sort((a, b) => b.annualRate - a.annualRate); // highest APR first (avalanche)
}

export interface HealthScore {
  total:   number;  // 0–100
  savings: number;  // 0–40: based on savings rate (20% rate = full score)
  budget:  number;  // 0–30: fraction of budgeted categories within limit
  runway:  number;  // 0–20: 6 months of expenses covered = full score
  fire:    number;  // 0–10: 50 % of the way to FIRE target = full score
}

/**
 * Financial health score 0–100 derived from four weighted components.
 */
export function getHealthScore(
  monthKey: string,
  netWorth: number,
  fireTarget: number,
): HealthScore {
  // ─ Savings component
  const txs = db.transactions[monthKey] ?? [];
  let inc = 0, exp = 0;
  txs.forEach(t => { if (t.type === 'income') inc += math(t.amount); else exp += math(t.amount); });
  const savingsRate = inc > 0 ? (inc - exp) / inc : 0;
  const savings = Math.round(40 * Math.min(Math.max(savingsRate / 0.20, 0), 1));

  // ─ Budget component
  const budgetEntries = Object.entries(db.budgets).filter(([, v]) => v > 0);
  const cats     = getCurrentCats(monthKey);
  const under    = budgetEntries.filter(([c, limit]) => (cats[c] ?? 0) <= limit).length;
  const budget   = budgetEntries.length > 0
    ? Math.round(30 * (under / budgetEntries.length))
    : 15; // neutral when no budgets set

  // ─ Runway component
  const avgExp      = getAvgMonthlyExpense(monthKey, 6);
  const runwayMonths = avgExp > 0 ? netWorth / avgExp : (netWorth > 0 ? 999 : 0);
  const runway      = Math.round(20 * Math.min(runwayMonths / 6, 1));

  // ─ FIRE component
  const firePct = fireTarget > 0 ? netWorth / fireTarget : 0;
  const fire    = Math.round(10 * Math.min(firePct / 0.5, 1));

  return { total: savings + budget + runway + fire, savings, budget, runway, fire };
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
