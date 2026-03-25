/**
 * Pure financial calculations that depend only on db + utils.
 * No imports from render or handlers — breaks the circular dep chain.
 */
import { db, persistOnly, saveCount } from './db';
import { math, sym, fmt } from './utils';
import type { Achievement, SmartTip } from './types';

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

/** Accumulate a transaction's spend into a category map, honouring splits. */
function addToCats(cats: Record<string, number>, t: { type: string; amount: number; category: string; splits?: import('./types').SplitEntry[] }): void {
  if (t.type !== 'expense') return;
  if (t.splits && t.splits.length > 0) {
    t.splits.forEach(s => { cats[s.category] = (cats[s.category] ?? 0) + math(s.amount); });
  } else {
    cats[t.category] = (cats[t.category] ?? 0) + math(t.amount);
  }
}

export function getCurrentCats(monthKey: string): Record<string, number> {
  const cats: Record<string, number> = {};
  (db.transactions[monthKey] ?? []).forEach(t => addToCats(cats, t));
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
    (db.transactions[k] ?? []).forEach(t => addToCats(totals, t));
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

// ─── Subscription Detector ────────────────────────────────────────────────────

export interface DetectedSubscription {
  desc: string;           // normalised description
  amount: number;         // typical amount
  category: string;       // category of the most recent match
  months: string[];       // YYYY-MM keys where it appears
  monthsCount: number;    // total consecutive-or-near-consecutive months seen
}

/**
 * Scans all transaction history for recurring expense patterns that look like
 * subscriptions: same description + same amount (±5%) appearing in 2+ months.
 * Returns list sorted by months detected (most recurring first).
 */
export function detectSubscriptions(): DetectedSubscription[] {
  // Group expenses by normalised description + rounded amount
  const groups = new Map<string, { desc: string; amount: number; category: string; months: Set<string> }>();

  Object.keys(db.transactions)
    .filter(isValidMonthKey)
    .forEach(k => {
      (db.transactions[k] ?? []).forEach(t => {
        if (t.type !== 'expense') return;
        // Normalise: lowercase, collapse whitespace
        const normDesc = t.desc.trim().toLowerCase().replace(/\s+/g, ' ');
        // Round to nearest pound/dollar so ±minor variation still groups
        const roundedAmt = Math.round(t.amount);
        if (roundedAmt === 0) return;
        const key = `${normDesc}||${roundedAmt}`;
        if (!groups.has(key)) {
          groups.set(key, { desc: t.desc, amount: t.amount, category: t.category, months: new Set() });
        }
        groups.get(key)!.months.add(k);
        // Keep the most recent category
        groups.get(key)!.category = t.category;
      });
    });

  const results: DetectedSubscription[] = [];
  groups.forEach(({ desc, amount, category, months }) => {
    if (months.size >= 2) {
      results.push({
        desc,
        amount,
        category,
        months: Array.from(months).sort(),
        monthsCount: months.size,
      });
    }
  });

  // Sort: most months seen first
  return results.sort((a, b) => b.monthsCount - a.monthsCount);
}

// ─── Spending Spike Detection ─────────────────────────────────────────────────

/**
 * Returns the average transaction amount for a given category over the last
 * n months (default 3), or null if there's no history.
 */
export function getCategoryAvgAmount(category: string, beforeKey: string, n = 3): number | null {
  const keys = getRecentMonthKeys(beforeKey, n);
  if (keys.length === 0) return null;
  let total = 0, count = 0;
  keys.forEach(k => {
    (db.transactions[k] ?? []).forEach(t => {
      if (t.type === 'expense' && t.category === category) {
        total += math(t.amount);
        count++;
      }
    });
  });
  return count > 0 ? total / count : null;
}

// ─── Smart Financial Recommendations ─────────────────────────────────────────

/**
 * Generates up to 6 contextual, prioritised financial recommendations based on
 * actual data patterns. Returns tips sorted by priority descending.
 */
export function getSmartTips(currentKey: string, netWorth: number, fireTarget: number): SmartTip[] {
  const tips: SmartTip[] = [];

  const txs = db.transactions[currentKey] ?? [];
  let inc = 0, exp = 0;
  txs.forEach(t => { if (t.type === 'income') inc += math(t.amount); else exp += math(t.amount); });
  const savingsRate = inc > 0 ? ((inc - exp) / inc) * 100 : 0;

  // 1. Low savings rate warning
  if (inc > 0 && savingsRate < 10) {
    tips.push({
      id: 'low-savings',
      type: 'warning',
      icon: 'fas fa-piggy-bank',
      title: 'Low savings rate',
      body: `You saved ${savingsRate.toFixed(1)}% of income this month. Financial experts recommend saving at least 20%. Try identifying your top 3 expense categories for cuts.`,
      priority: 90,
    });
  } else if (inc > 0 && savingsRate >= 20) {
    tips.push({
      id: 'great-savings',
      type: 'success',
      icon: 'fas fa-trophy',
      title: 'Strong savings rate',
      body: `You saved ${savingsRate.toFixed(1)}% of your income this month — above the recommended 20%. Keep it up!`,
      priority: 20,
    });
  }

  // 2. Budget overruns
  const cats = getCurrentCats(currentKey);
  const overBudget = Object.entries(db.budgets).filter(([c, limit]) => limit > 0 && (cats[c] ?? 0) > limit);
  if (overBudget.length > 0) {
    const worst = overBudget.sort((a, b) => (cats[b[0]] ?? 0) / b[1] - (cats[a[0]] ?? 0) / a[1])[0];
    const pct = Math.round(((cats[worst[0]] ?? 0) / worst[1]) * 100);
    tips.push({
      id: 'budget-overrun',
      type: 'warning',
      icon: 'fas fa-exclamation-triangle',
      title: `Over budget: ${worst[0]}`,
      body: `You've spent ${pct}% of your ${worst[0]} budget this month (${sym()}${fmt(cats[worst[0]] ?? 0)} of ${sym()}${fmt(worst[1])} limit). ${overBudget.length > 1 ? `${overBudget.length - 1} other categor${overBudget.length === 2 ? 'y is' : 'ies are'} also over budget.` : ''}`,
      priority: 85,
    });
  }

  // 3. Subscription cost awareness
  const subs = detectSubscriptions();
  if (subs.length >= 3) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const recentSubs = subs.filter(s => s.months[s.months.length - 1] >= currentMonth.slice(0, 7).replace(/\d$/, '0') || s.monthsCount >= 3);
    const monthlySubTotal = recentSubs.reduce((sum, s) => sum + math(s.amount), 0);
    if (monthlySubTotal > 50) {
      tips.push({
        id: 'subscription-total',
        type: 'opportunity',
        icon: 'fas fa-repeat',
        title: `${sym()}${fmt(monthlySubTotal)}/mo on subscriptions`,
        body: `${recentSubs.length} recurring expenses detected totalling ${sym()}${fmt(monthlySubTotal)}/month (${sym()}${fmt(math(monthlySubTotal * 12))}/year). Review the Detected Subscriptions section to identify any unused services.`,
        priority: 70,
      });
    }
  }

  // 4. Low cash runway
  const avgExp = getAvgMonthlyExpense(currentKey, 6);
  const runway = avgExp > 0 ? netWorth / avgExp : Infinity;
  if (runway < 3 && isFinite(runway)) {
    tips.push({
      id: 'low-runway',
      type: 'warning',
      icon: 'fas fa-hourglass-half',
      title: 'Emergency fund at risk',
      body: `Your cash runway is only ${runway.toFixed(1)} months. Financial advisors recommend 3–6 months of expenses as an emergency fund. Focus on building this before other financial goals.`,
      priority: 95,
    });
  } else if (runway >= 6 && isFinite(runway) && runway < 100) {
    tips.push({
      id: 'good-runway',
      type: 'success',
      icon: 'fas fa-shield-alt',
      title: `${runway.toFixed(1)}-month emergency buffer`,
      body: `Your net worth covers ${runway.toFixed(1)} months of expenses. Your emergency fund is solid — consider directing surplus savings toward investment goals.`,
      priority: 15,
    });
  }

  // 5. High-interest debt warning
  const highInterestDebts = db.wealth.debts.filter(d => math(d.interestRate ?? 0) > 15 && math(d.value) > 0);
  if (highInterestDebts.length > 0) {
    const worst = highInterestDebts.sort((a, b) => math(b.interestRate ?? 0) - math(a.interestRate ?? 0))[0];
    tips.push({
      id: 'high-interest-debt',
      type: 'warning',
      icon: 'fas fa-credit-card',
      title: `High-interest debt: ${worst.name}`,
      body: `"${worst.name}" carries a ${math(worst.interestRate)}% APR. High-interest debt erodes wealth quickly. Use the avalanche method — pay this off first before lower-rate debts.`,
      priority: 88,
    });
  }

  // 6. Spending spike
  const velocity = getSpendingVelocity(currentKey);
  const bigSpike = velocity.filter(v => v.avg > 0 && v.pct > 75 && v.diff > 50).sort((a, b) => b.diff - a.diff)[0];
  if (bigSpike) {
    tips.push({
      id: 'spending-spike',
      type: 'info',
      icon: 'fas fa-chart-line',
      title: `${bigSpike.category} spending up ${bigSpike.pct.toFixed(0)}%`,
      body: `Your ${bigSpike.category} spending is ${sym()}${fmt(bigSpike.current)} this month — ${bigSpike.pct.toFixed(0)}% above your 3-month average of ${sym()}${fmt(bigSpike.avg)}. One-off or new habit?`,
      priority: 60,
    });
  }

  // 7. FIRE progress milestone
  if (fireTarget > 0 && netWorth > 0) {
    const firePct = (netWorth / fireTarget) * 100;
    if (firePct >= 25 && firePct < 75) {
      tips.push({
        id: 'fire-progress',
        type: 'info',
        icon: 'fas fa-fire',
        title: `${firePct.toFixed(0)}% of the way to FIRE`,
        body: `You've reached ${firePct.toFixed(0)}% of your Financial Independence target of ${sym()}${fmt(fireTarget)}. ${firePct >= 50 ? 'Over halfway there!' : 'You\'re making real progress — keep investing consistently.'}`,
        priority: 40,
      });
    }
  }

  // 8. No budgets set
  const hasBudgets = Object.values(db.budgets).some(v => v > 0);
  if (!hasBudgets && exp > 0) {
    tips.push({
      id: 'no-budgets',
      type: 'opportunity',
      icon: 'fas fa-sliders-h',
      title: 'Set spending limits',
      body: 'You have no category budgets defined yet. Users with category budgets are 37% more likely to stay on track. Visit the Budgets section to set monthly limits.',
      priority: 55,
    });
  }

  // 9. Goals overdue
  const now = new Date().toISOString().slice(0, 10);
  const overdueGoals = db.goals.filter(g => g.deadline && g.deadline < now && g.current < g.target);
  if (overdueGoals.length > 0) {
    tips.push({
      id: 'overdue-goals',
      type: 'info',
      icon: 'fas fa-flag',
      title: `${overdueGoals.length} overdue saving${overdueGoals.length > 1 ? 's goal' : ' goal'}${overdueGoals.length > 1 ? 's' : ''}`,
      body: `${overdueGoals.length > 1 ? `${overdueGoals.length} savings goals have` : `"${overdueGoals[0].name}" has`} passed their deadline. Consider updating the targets or extending the deadlines in the Goals section.`,
      priority: 50,
    });
  }

  return tips.sort((a, b) => b.priority - a.priority).slice(0, 6);
}

// ─── Achievement System ───────────────────────────────────────────────────────

/**
 * Computes which achievements the user has earned based on their financial data.
 * Achievements are derived, not stored — always consistent with actual data.
 */
export function getAchievements(currentKey: string, netWorth: number, fireTarget: number): Achievement[] {
  const today = new Date().toISOString().slice(0, 10);

  const allTxs = Object.values(db.transactions).flat();
  const totalMonths = Object.keys(db.transactions).filter(isValidMonthKey).length;
  const txs = db.transactions[currentKey] ?? [];
  let mInc = 0, mExp = 0;
  txs.forEach(t => { if (t.type === 'income') mInc += math(t.amount); else mExp += math(t.amount); });
  const savingsRate = mInc > 0 ? ((mInc - mExp) / mInc) * 100 : 0;

  const budgetEntries = Object.entries(db.budgets).filter(([, v]) => v > 0);
  const cats = getCurrentCats(currentKey);
  const allUnder = budgetEntries.length > 0 && budgetEntries.every(([c, limit]) => (cats[c] ?? 0) <= limit);

  const completedGoals = db.goals.filter(g => g.current >= g.target);
  const hasNoDebt = db.wealth.debts.length > 0 && db.wealth.debts.every(d => math(d.value) <= 0);

  // Check for 3-month savings streak (savings rate ≥ 10% for 3 consecutive months)
  const recentKeys = getRecentMonthKeys(currentKey, 3);
  const savingsStreak = recentKeys.length >= 3 && recentKeys.every(k => {
    let i = 0, e = 0;
    (db.transactions[k] ?? []).forEach(t => { if (t.type === 'income') i += math(t.amount); else e += math(t.amount); });
    return i > 0 && ((i - e) / i) * 100 >= 10;
  });

  const firePct = fireTarget > 0 ? (netWorth / fireTarget) * 100 : 0;

  return [
    {
      id: 'first-step',
      title: 'First Step',
      desc: 'Log your very first transaction',
      icon: 'fas fa-shoe-prints',
      earned: allTxs.length > 0,
      earnedAt: today,
    },
    {
      id: 'budget-keeper',
      title: 'Budget Keeper',
      desc: 'Stay within all category budgets in a single month',
      icon: 'fas fa-check-circle',
      earned: allUnder,
      earnedAt: today,
    },
    {
      id: 'goal-getter',
      title: 'Goal Getter',
      desc: 'Complete a savings goal',
      icon: 'fas fa-bullseye',
      earned: completedGoals.length > 0,
      earnedAt: today,
    },
    {
      id: 'super-saver',
      title: 'Super Saver',
      desc: 'Save 20%+ of your income in a single month',
      icon: 'fas fa-piggy-bank',
      earned: savingsRate >= 20,
      earnedAt: today,
    },
    {
      id: 'net-positive',
      title: 'Net Positive',
      desc: 'Achieve a positive net worth',
      icon: 'fas fa-chart-line',
      earned: netWorth > 0,
      earnedAt: today,
    },
    {
      id: 'debt-buster',
      title: 'Debt Buster',
      desc: 'Pay off all your debts',
      icon: 'fas fa-scissors',
      earned: hasNoDebt,
      earnedAt: today,
    },
    {
      id: 'streak-3',
      title: 'Savings Streak',
      desc: 'Save 10%+ for 3 consecutive months',
      icon: 'fas fa-fire-flame-curved',
      earned: savingsStreak,
      earnedAt: today,
    },
    {
      id: 'long-hauler',
      title: 'Long Hauler',
      desc: 'Track finances for 6+ months',
      icon: 'fas fa-calendar-check',
      earned: totalMonths >= 6,
      earnedAt: today,
    },
    {
      id: 'fire-starter',
      title: 'FIRE Starter',
      desc: 'Reach 50% of your Financial Independence target',
      icon: 'fas fa-fire',
      earned: firePct >= 50,
      earnedAt: today,
    },
    {
      id: 'wealth-builder',
      title: 'Wealth Builder',
      desc: 'Log assets in 3 different categories',
      icon: 'fas fa-landmark',
      earned: new Set(db.wealth.assets.map(a => a.type)).size >= 3,
      earnedAt: today,
    },
  ];
}
