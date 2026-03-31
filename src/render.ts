import { db, save, persistOnly } from './db';
import { showToast } from './toast';
import { math, fmt, esc, sym, symFmt, getMonthKey } from './utils';
import { BUDGET_WARN_PCT, CALENDAR_MAX_CHIPS } from './constants';
import { updateDashboardCharts, updateYearlyChart, updateWealthCharts, calcFireStats, updateDebtTimelineChart, updateCategoryTrendChart } from './charts';
import { getMonthPicker } from './main';
import {
  getRollover, getCurrentCats, consolidateWealth, isValidMonthKey,
  getSpendingVelocity, getDailyBurnRate, getMonthEndForecast,
  getCashRunway, getDebtPayoffPlans, compareDebtStrategies, getHealthScore, getRecentMonthKeys,
  detectSubscriptions, getSmartTips, getAchievements, detectRecurringCandidates,
  type VelocityEntry,
} from './finance';

// ─── Debt simulator state ─────────────────────────────────────────────────────
export let _debtStrategy: 'avalanche' | 'snowball' = 'avalanche';
export let _debtExtra = 0;
export function setDebtSimulatorOpts(s: 'avalanche' | 'snowball', extra: number): void {
  _debtStrategy = s;
  _debtExtra    = extra;
  renderDebtPlanner();
}

// ─── Goal quick-contribute state ──────────────────────────────────────────────
let _contribGoalId: string | null = null;
export function setContribGoalId(id: string | null): void {
  _contribGoalId = id;
  renderGoals();
}

export { getRollover, getCurrentCats };

// ─── Bulk selection state (exported for handlers) ─────────────────────────────
export const selectedTxIds = new Set<string>();
/** Tracks the last-rendered month key so selection can be cleared on month change */
let _lastRenderKey = '';

// ─── Main dashboard render ────────────────────────────────────────────────────

export function render(): void {
  try {
    const key = getMonthPicker().value;
    // Clear bulk selection when the user navigates to a different month — stale IDs
    // from a previous month would pollute db.deletedIds if bulk-deleted accidentally.
    if (key !== _lastRenderKey) { selectedTxIds.clear(); _lastRenderKey = key; }
    const searchEl = document.getElementById('txSearch') as HTMLInputElement | null;
    const searchTerm = searchEl?.value.toLowerCase() ?? '';
    const data = db.transactions[key] ?? [];

    // Full-month KPIs (unaffected by search/filter)
    let inc = 0, exp = 0;
    const cats: Record<string, number> = {};
    data.forEach(t => {
      const val = math(t.amount);
      if (t.type === 'income') inc += val;
      else if (t.type === 'expense') { exp += val; cats[t.category] = (cats[t.category] ?? 0) + val; }
    });

    // Filtered transaction list
    const catFilter    = (document.getElementById('txCatFilter')  as HTMLSelectElement | null)?.value ?? '';
    const acctFilter   = (document.getElementById('txAccountFilter') as HTMLSelectElement | null)?.value ?? '';
    const dateFrom     = (document.getElementById('filterDateFrom') as HTMLInputElement | null)?.value ?? '';
    const dateTo       = (document.getElementById('filterDateTo')   as HTMLInputElement | null)?.value ?? '';
    const amtMinStr    = (document.getElementById('filterAmtMin')   as HTMLInputElement | null)?.value ?? '';
    const amtMaxStr    = (document.getElementById('filterAmtMax')   as HTMLInputElement | null)?.value ?? '';
    const amtMin       = amtMinStr ? parseFloat(amtMinStr) : null;
    const amtMax       = amtMaxStr ? parseFloat(amtMaxStr) : null;
    const hasAdvFilter = !!(dateFrom || dateTo || amtMinStr || amtMaxStr);

    // Highlight the filter button when advanced filters are active
    const filterBtn = document.getElementById('btnFilterToggle');
    if (filterBtn) {
      filterBtn.classList.toggle('border-indigo-500', hasAdvFilter);
      filterBtn.classList.toggle('text-indigo-500', hasAdvFilter);
      filterBtn.classList.toggle('bg-indigo-50', hasAdvFilter);
      filterBtn.classList.toggle('dark:bg-indigo-900/20', hasAdvFilter);
    }

    const filtered = data.filter(t => {
      const txDate = t.date ?? '';
      const matchSearch = !searchTerm
        || t.desc.toLowerCase().includes(searchTerm)
        || t.category.toLowerCase().includes(searchTerm)
        || (t.notes ?? '').toLowerCase().includes(searchTerm)
        || String(t.amount).includes(searchTerm)
        || (t.tags ?? []).some(tag => tag.includes(searchTerm));
      const matchCat    = !catFilter || t.category === catFilter;
      const matchAcct   = !acctFilter || (t.account ?? '') === acctFilter;
      const matchFrom   = !dateFrom || txDate >= dateFrom;
      const matchTo     = !dateTo   || txDate <= dateTo;
      const matchAmt    = (amtMin === null || t.amount >= amtMin) && (amtMax === null || t.amount <= amtMax);
      return matchSearch && matchCat && matchAcct && matchFrom && matchTo && matchAmt;
    });
    filtered.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.updatedAt - a.updatedAt);

    // Update screen-reader live region with result count
    const filterStatus = document.getElementById('filterStatus');
    if (filterStatus && (searchTerm || catFilter || hasAdvFilter)) {
      filterStatus.textContent = `${filtered.length} transaction${filtered.length !== 1 ? 's' : ''} shown`;
    }

    const list = document.getElementById('listTx');
    if (list) {
      // Use DocumentFragment to batch all DOM insertions in one reflow
      const frag = document.createDocumentFragment();
      filtered.forEach(t => {
        const val = math(t.amount);
        const colorClass = t.type === 'income'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400';
        const sign = t.type === 'income' ? '+' : '-';
        const isChecked = selectedTxIds.has(t.id);
        // Build tag chips HTML (all values from stored tags array, already sanitized on save)
        const tagsHtml = (t.tags ?? []).length
          ? `<div class="flex flex-wrap gap-1 mt-1">${(t.tags!).map(tag =>
              `<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">#${esc(tag)}</span>`
            ).join('')}</div>`
          : '';
        const tr = document.createElement('tr');
        tr.className = `border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition group${isChecked ? ' bg-indigo-50 dark:bg-indigo-900/10' : ''}`;
        tr.innerHTML = `
          <td class="pl-2 py-3 w-8">
            <input type="checkbox" data-tx-checkbox="${esc(t.id)}" ${isChecked ? 'checked' : ''} class="accent-indigo-600 rounded cursor-pointer">
          </td>
          <td class="py-3">
            <div class="font-bold text-slate-700 dark:text-slate-200">${esc(t.desc)}</div>
            <div class="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-500">${esc(t.category)}</div>
            ${t.notes ? `<div class="text-[10px] text-slate-400 mt-1 italic truncate max-w-[200px]" title="${esc(t.notes)}">${esc(t.notes)}</div>` : ''}
            ${tagsHtml}
          </td>
          <td class="text-right font-bold ${colorClass} money-val">${sign}${sym()}${fmt(val)}</td>
          <td class="text-right pr-2">
            <button type="button" data-edit-tx="${esc(t.id)}" class="text-slate-300 hover:text-indigo-500 transition px-2" aria-label="Edit ${esc(t.desc)}"><i class="fas fa-pencil-alt"></i></button>
            <button type="button" data-del-tx="${esc(t.id)}" class="text-slate-300 hover:text-rose-500 transition px-2" aria-label="Delete ${esc(t.desc)}"><i class="fas fa-trash-alt"></i></button>
          </td>`;
        frag.appendChild(tr);
      });
      list.innerHTML = '';
      list.appendChild(frag);
      // Keep select-all checkbox in sync
      const selectAll = document.getElementById('selectAllTx') as HTMLInputElement | null;
      if (selectAll) {
        selectAll.checked = filtered.length > 0 && filtered.every(t => selectedTxIds.has(t.id));
        selectAll.indeterminate = !selectAll.checked && filtered.some(t => selectedTxIds.has(t.id));
      }
    }

    const emptyEl = document.getElementById('emptyState');
    if (emptyEl) {
      emptyEl.classList.toggle('hidden', filtered.length > 0);
      // Update the sub-message to distinguish "no data" from "filtered out"
      const msgEl = document.getElementById('emptyStateMsg');
      if (msgEl) {
        msgEl.textContent = data.length > 0 && filtered.length === 0
          ? 'No results match your search or filters.'
          : 'Add your first transaction to get started.';
      }
    }

    const rollover = getRollover(key);
    const kpiInc = document.getElementById('kpiInc');
    // Build via DOM (not innerHTML) so the currency symbol cannot inject HTML
    if (kpiInc) {
      kpiInc.textContent = '';
      const mainText = document.createTextNode(symFmt(inc + rollover) + ' ');
      const rollSpan = document.createElement('span');
      rollSpan.className = 'text-[10px] text-slate-400 block font-medium uppercase mt-1';
      const rolloverLabel = rollover < 0
        ? `-${sym()}${fmt(Math.abs(rollover))}`
        : `${sym()}${fmt(rollover)}`;
      rollSpan.textContent = `Rollover: ${rolloverLabel}`;
      kpiInc.appendChild(mainText);
      kpiInc.appendChild(rollSpan);
    }
    setText('kpiExp', `${sym()}${fmt(exp)}`);
    setText('kpiSalary', `${sym()}${fmt(db.annualIncome)}`);

    const year = key.split('-')[0];
    let ytd = 0;
    Object.keys(db.transactions).forEach(k => {
      // Only count months up to and including the currently viewed month so
      // viewing a past month doesn't inflate YTD with later months' income.
      if (isValidMonthKey(k) && k.startsWith(year) && k <= key)
        db.transactions[k].forEach(t => { if (t.type === 'income') ytd += math(t.amount); });
    });
    setText('kpiYTD', `${sym()}${fmt(ytd)}`);
    const monthNum = parseInt(key.split('-')[1] ?? '1', 10);
    const safeMonth = monthNum >= 1 && monthNum <= 12 ? monthNum : 1;
    setText('kpiAvg', `${sym()}${fmt(ytd / safeMonth)}`);

    let maxCat = 'N/A', maxVal = 0;
    for (const [c, v] of Object.entries(cats)) { if (v > maxVal) { maxVal = v; maxCat = c; } }
    setText('kpiMaxCat', maxCat);
    // Keep tooltip in sync so truncated names are readable on hover
    const maxCatEl = document.getElementById('kpiMaxCat');
    if (maxCatEl) maxCatEl.title = maxCat;
    setText('kpiMaxVal', `${sym()}${fmt(maxVal)}`);

    const savedAmt = inc - exp;
    const savingsRate = inc > 0 ? (savedAmt / inc) * 100 : 0;
    const isDeficit = savedAmt < 0;
    const rateEl = document.getElementById('kpiSavingsRate');
    if (rateEl) {
      rateEl.innerText = `${savingsRate.toFixed(1)}%`;
      rateEl.className = `text-2xl font-bold mt-1 ${isDeficit ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400'}`;
    }
    setText('kpiSavingsAmt', isDeficit ? `${sym()}${fmt(Math.abs(savedAmt))} deficit` : `${sym()}${fmt(savedAmt)} saved`);

    // ─ Second-row KPIs: daily burn, month-end projection, cash runway, budget pace ─
    const totalAssets = db.wealth.assets.reduce((a, b) => a + math(b.value), 0);
    const totalDebts  = db.wealth.debts.reduce((a, b) => a + math(b.value), 0);
    const netWorthKpi = totalAssets + (inc + rollover - exp) - totalDebts;
    setText('kpiBurnRate', `${sym()}${fmt(getDailyBurnRate(key))}`);
    setText('kpiForecast', `${sym()}${fmt(getMonthEndForecast(key))}`);
    const runwayVal = getCashRunway(netWorthKpi, key);
    const runwayKpiEl = document.getElementById('kpiRunway');
    if (runwayKpiEl) {
      runwayKpiEl.textContent = (!isFinite(runwayVal) || runwayVal > 999)
        ? '999+ mo' : `${runwayVal.toFixed(1)} mo`;
      runwayKpiEl.className = `text-2xl font-bold mt-1 money-val ${
        runwayVal >= 6 ? 'text-teal-600 dark:text-teal-400' :
        runwayVal >= 3 ? 'text-amber-600 dark:text-amber-400' :
                         'text-rose-600 dark:text-rose-400'
      }`;
    }

    // ─ Budget pacing KPI: how much can be spent per day to stay on budget ────
    const budgetPaceEl = document.getElementById('kpiBudgetPace');
    if (budgetPaceEl) {
      const todayNow = new Date();
      const isCurrentMonth = key === getMonthKey(todayNow);
      const totalBudget = Object.values(db.budgets).reduce((s, v) => s + (v > 0 ? v : 0), 0);
      if (totalBudget > 0 && isCurrentMonth) {
        const [bpY, bpM] = key.split('-').map(Number);
        const daysInMonth = new Date(bpY, bpM, 0).getDate();
        const daysRemaining = daysInMonth - todayNow.getDate() + 1; // include today
        const budgetRemaining = totalBudget - exp;
        const pace = daysRemaining > 0 ? budgetRemaining / daysRemaining : 0;
        const isOver = budgetRemaining < 0;
        budgetPaceEl.textContent = isOver ? 'Over budget' : `${sym()}${fmt(pace)}/day`;
        budgetPaceEl.className = `text-2xl font-bold mt-1 money-val ${
          isOver    ? 'text-rose-600 dark:text-rose-400' :
          pace < 5  ? 'text-amber-600 dark:text-amber-400' :
                      'text-emerald-600 dark:text-emerald-400'
        }`;
      } else {
        budgetPaceEl.textContent = '—';
        budgetPaceEl.className = 'text-2xl font-bold mt-1 text-slate-400';
      }
    }

    const todayKey = getMonthKey(new Date());
    const banner = document.getElementById('monthBanner');
    if (banner) {
      if (key !== todayKey) {
        banner.classList.remove('hidden');
        const [by, bm] = key.split('-').map(Number);
        setText('monthBannerLabel', new Date(by, bm - 1).toLocaleString('default', { month: 'long', year: 'numeric' }));
      } else {
        banner.classList.add('hidden');
      }
    }

    renderUpcomingBills();
    renderHealthAmbientBar(key, netWorthKpi);
    renderMonthPressureGauge(key);
    updateChartSummaries(cats, inc, exp);

    if (!document.getElementById('view-dashboard')?.classList.contains('hidden')) {
      // Only pass forecast for current month — past months don't need a ghost bar
      const isCurrentMonth = key === getMonthKey(new Date());
      updateDashboardCharts(cats, isCurrentMonth ? getMonthEndForecast(key) : undefined);
    }
    if (!document.getElementById('view-budget')?.classList.contains('hidden')) {
      renderBudgets();
    }
    // Keep the bulk action bar in sync — especially important when month change
    // clears selectedTxIds; without this the bar stays visible showing a stale count.
    updateBulkBar();
  } catch (e) {
    console.error('Render crash avoided:', e);
  }
}

// Re-export getCurrentCats using month picker for callers that don't pass the key
export function getCurrentCatsFromPicker(): Record<string, number> {
  return getCurrentCats(getMonthPicker().value);
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────
/** Show/hide the bulk-action bar and update its selection count. */
export function updateBulkBar(): void {
  const count = selectedTxIds.size;
  const bar = document.getElementById('bulkBar');
  bar?.classList.toggle('hidden', count === 0);
  const countEl = document.getElementById('bulkCount');
  if (countEl) countEl.textContent = `${count} selected`;
}

// ─── Financial Health Ambient Bar ────────────────────────────────────────────
/**
 * Updates a slim progress bar at the top of the dashboard that pulses
 * rose/amber/emerald based on the financial health score — an ambient
 * "at-a-glance" wellness indicator that changes without the user asking.
 */
function renderHealthAmbientBar(key: string, netWorth: number): void {
  const barEl  = document.getElementById('healthAmbientBar');
  const fillEl = document.getElementById('healthAmbientFill');
  if (!barEl || !fillEl) return;

  const { fireTarget } = calcFireStats(netWorth);
  const health = getHealthScore(key, netWorth, fireTarget);
  const score  = health.total;

  barEl.classList.remove('hidden');
  fillEl.style.width = `${score}%`;
  fillEl.classList.remove('health-low', 'bg-rose-500', 'bg-amber-400', 'bg-emerald-500');

  if (score < 40) {
    fillEl.classList.add('bg-rose-500', 'health-low');
    barEl.title = `Financial Health: ${score}/100 — Needs attention`;
  } else if (score < 70) {
    fillEl.classList.add('bg-amber-400');
    barEl.title = `Financial Health: ${score}/100 — Good, room to improve`;
  } else {
    fillEl.classList.add('bg-emerald-500');
    barEl.title = `Financial Health: ${score}/100 — Excellent`;
  }

  // Apply "Financial Weather" — health-tier-driven sidebar skin
  const tier = score >= 75 ? 'thriving' : score >= 45 ? 'steady' : 'watchful';
  document.documentElement.dataset['healthTier'] = tier;
}

// ─── Month Pressure Gauge ─────────────────────────────────────────────────────
/**
 * Day-of-month progress bar. Turns amber/rose + pulses when the user is on pace
 * to exceed their total monthly budget. Only shown for the current month.
 */
function renderMonthPressureGauge(key: string): void {
  const barEl   = document.getElementById('monthPressureBar');
  const fillEl  = document.getElementById('monthPressureFill');
  const labelEl = document.getElementById('monthPressureLabel');
  const noteEl  = document.getElementById('monthPressureNote');
  const trackEl = document.getElementById('monthPressureTrack');
  if (!barEl || !fillEl || !labelEl || !noteEl || !trackEl) return;

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (key !== todayKey) { barEl.classList.add('hidden'); return; }

  const [y, m] = key.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today    = now.getDate();
  const dayPct   = Math.round((today / daysInMonth) * 100);
  const daysLeft = daysInMonth - today;

  barEl.classList.remove('hidden');
  fillEl.style.width = `${dayPct}%`;
  trackEl.setAttribute('aria-valuenow', String(dayPct));
  trackEl.setAttribute('aria-valuetext', `${dayPct}% through the month`);
  trackEl.setAttribute('aria-label', `Month progress: day ${today} of ${daysInMonth}`);
  labelEl.textContent = `Day ${today} of ${daysInMonth}`;

  const forecast    = getMonthEndForecast(key);
  const totalBudget = Object.values(db.budgets).reduce((s, v) => s + v, 0);
  const isOverpace  = totalBudget > 0 && forecast > totalBudget;

  fillEl.classList.remove('pressure-warn', 'bg-rose-500', 'bg-amber-400', 'bg-sky-500');
  if (daysLeft <= 5 && isOverpace) {
    fillEl.classList.add('bg-rose-500', 'pressure-warn');
    noteEl.textContent = `On pace to exceed budget — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
  } else if (isOverpace) {
    fillEl.classList.add('bg-amber-400');
    noteEl.textContent = `Forecast ${sym()}${fmt(forecast)} — over budget pace`;
  } else {
    fillEl.classList.add('bg-sky-500');
    noteEl.textContent = daysLeft === 0 ? 'Last day of the month' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`;
  }
}

// ─── Screen-reader chart summaries ────────────────────────────────────────────
/**
 * Populates sr-only text summaries next to each chart so screen readers can
 * convey the key data points without needing to interpret canvas visuals.
 */
function updateChartSummaries(cats: Record<string, number>, inc: number, exp: number): void {
  const spendEl = document.getElementById('chartSpendSummary');
  if (spendEl) {
    const topCats = Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c, v]) => `${c}: ${sym()}${fmt(v)}`)
      .join(', ');
    spendEl.textContent = topCats
      ? `Spending breakdown this month: ${topCats}.`
      : 'No spending data for this month.';
  }

  const trendEl = document.getElementById('chartTrendSummary');
  if (trendEl) {
    const savingsAmt = math(inc - exp);
    const saved = savingsAmt >= 0
      ? `saved ${sym()}${fmt(savingsAmt)}`
      : `deficit of ${sym()}${fmt(Math.abs(savingsAmt))}`;
    trendEl.textContent = `This month: income ${sym()}${fmt(inc)}, expenses ${sym()}${fmt(exp)}, ${saved}.`;
  }
}

// ─── Spending Heatmap ─────────────────────────────────────────────────────────
/**
 * Renders a GitHub-style contribution heatmap showing daily spending intensity
 * for the last 12 weeks. Each cell is one day; colour depth = spend amount.
 */
export function renderSpendingHeatmap(): void {
  const gridEl = document.getElementById('insHeatmapGrid');
  if (!gridEl) return;

  const today = new Date();
  // Align to a Sunday so columns are full weeks
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - endDate.getDay() + 6); // end on Saturday

  const WEEKS = 13;
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - WEEKS * 7 + 1);

  // Build a date→spend map from all transactions
  const daySpend: Record<string, number> = {};
  Object.values(db.transactions).flat().forEach(t => {
    if (t.type !== 'expense' || !t.date) return;
    daySpend[t.date] = (daySpend[t.date] ?? 0) + math(t.amount);
  });

  // Find max for normalisation
  const maxSpend = Math.max(1, ...Object.values(daySpend));

  const cols: string[] = [];
  for (let w = 0; w < WEEKS; w++) {
    const cells: string[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + w * 7 + d);
      if (date > today) {
        cells.push(`<div class="heatmap-cell bg-transparent" aria-hidden="true"></div>`);
        continue;
      }
      const key = date.toISOString().slice(0, 10);
      const spend = daySpend[key] ?? 0;
      const ratio = spend / maxSpend;
      const bg = spend === 0 ? 'bg-slate-100 dark:bg-slate-800'
        : ratio < 0.25 ? 'bg-rose-100 dark:bg-rose-900/40'
        : ratio < 0.5  ? 'bg-rose-200 dark:bg-rose-700/60'
        : ratio < 0.75 ? 'bg-rose-400 dark:bg-rose-600'
        :                'bg-rose-600 dark:bg-rose-500';
      const tipDate = date.toLocaleDateString('default', { month: 'short', day: 'numeric' });
      const tip = spend > 0 ? `${tipDate}: ${sym()}${fmt(spend)}` : tipDate;
      const label = `${tipDate}${spend > 0 ? `: spent ${sym()}${fmt(spend)}` : ': no spending'}`;
      cells.push(`<div class="heatmap-cell ${bg}" data-tip="${esc(tip)}" aria-label="${esc(label)}" role="img"></div>`);
    }
    cols.push(`<div class="heatmap-col">${cells.join('')}</div>`);
  }
  gridEl.innerHTML = cols.join('');
}

// ─── Budgets ──────────────────────────────────────────────────────────────────
export function renderBudgets(): void {
  const inputsDiv = document.getElementById('budgetInputs');
  if (inputsDiv) {
    inputsDiv.innerHTML = '';
    db.categories.forEach(c => {
      if (c === 'Bills') return;
      const val = db.budgets[c] ?? 0;
      const div = document.createElement('div');
      div.className = 'flex items-center gap-2';
      div.innerHTML = `<span class="text-xs font-bold text-slate-500 w-1/3 truncate">${esc(c)}</span>`;
      const input = document.createElement('input');
      input.type = 'number';
      input.value = val > 0 ? String(val) : '';
      input.placeholder = 'Not Set';
      input.className = 'w-full p-2 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-white outline-none';
      input.addEventListener('change', () => {
        db.budgets[c] = math(input.value);
        save();
        renderBudgets();
      });
      div.appendChild(input);
      inputsDiv.appendChild(div);
    });
  }

  const key = getMonthPicker().value;
  const cats = getCurrentCats(key);

  // Last-month key for MoM delta badges
  const [bmy0, bmm0] = key.split('-').map(Number);
  const prevDate = new Date(bmy0, bmm0 - 2); // month is 0-indexed, so -2 = previous month
  const prevKey  = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prevCats: Record<string, number> = {};
  (db.transactions[prevKey] ?? []).forEach(t => {
    if (t.type === 'expense') prevCats[t.category] = (prevCats[t.category] ?? 0) + math(t.amount);
  });

  const barsDiv = document.getElementById('budgetBars');
  if (barsDiv) {
    barsDiv.innerHTML = '';
    let hasBudget = false;
    const [bmy, bmm] = key.split('-').map(Number);
    setText('budgetMonthLabel', new Date(bmy, bmm - 1).toLocaleString('default', { month: 'long', year: 'numeric' }));
    Object.keys(db.budgets).forEach(c => {
      const budget = db.budgets[c];
      if (budget > 0) {
        hasBudget = true;
        const spent    = cats[c] ?? 0;
        const prevSpent = prevCats[c] ?? 0;
        const pct = Math.min((spent / budget) * 100, 100);
        let color = 'bg-emerald-500', statusLabel = 'On budget', statusClass = 'text-emerald-600 dark:text-emerald-400';
        if (pct > BUDGET_WARN_PCT) { color = 'bg-amber-500'; statusLabel = 'Approaching limit'; statusClass = 'text-amber-600 dark:text-amber-400'; }
        if (pct >= 100) { color = 'bg-rose-500'; statusLabel = 'Over budget'; statusClass = 'text-rose-600 dark:text-rose-400'; }

        // Month-over-month delta badge
        let momBadge = '';
        if (prevSpent > 0) {
          const delta   = spent - prevSpent;
          const deltaPct = Math.round(Math.abs(delta / prevSpent) * 100);
          if (Math.abs(delta) >= 0.01) {
            const up  = delta > 0;
            momBadge = `<span class="text-[10px] font-bold ${up ? 'text-rose-500' : 'text-emerald-500'} ml-1.5" title="vs last month">
              ${up ? '▲' : '▼'}${deltaPct}%
            </span>`;
          }
        }

        barsDiv.insertAdjacentHTML('beforeend',
          `<div>
            <div class="flex justify-between items-end mb-1">
              <div class="flex items-center">
                <span class="font-bold text-sm text-slate-700 dark:text-slate-200">${esc(c)}</span>
                ${momBadge}
              </div>
              <div class="text-right">
                <span class="text-xs font-bold text-slate-500"><span class="money-val">${sym()}${fmt(spent)}</span> / <span class="money-val">${sym()}${fmt(budget)}</span></span>
                <span class="block text-[10px] font-bold ${statusClass}">${statusLabel}</span>
              </div>
            </div>
            <div class="progress-bar-bg bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(c)} budget: ${statusLabel}">
              <div class="progress-bar-fill ${color}" style="width:${pct}%"></div>
            </div>
          </div>`);
      }
    });
    document.getElementById('budgetEmpty')?.classList.toggle('hidden', hasBudget);
  }

  // ─ Budget alerts (only for current month to avoid noise on historical views) ─
  checkBudgetAlerts();
}

// Budget alert state: track which alerts have already been shown this session
// so we don't spam the user on every re-render.
const _shownBudgetAlerts = new Set<string>();

function checkBudgetAlerts(): void {
  const todayKey = getMonthKey(new Date());
  if (getMonthPicker().value !== todayKey) return; // only alert on current month
  const cats = getCurrentCats(todayKey);
  Object.keys(db.budgets).forEach(c => {
    const budget = db.budgets[c];
    if (!budget) return;
    const spent = cats[c] ?? 0;
    const pct = (spent / budget) * 100;
    // 100% alert
    const overKey = `over:${c}:${todayKey}`;
    if (pct >= 100 && !_shownBudgetAlerts.has(overKey)) {
      _shownBudgetAlerts.add(overKey);
      showBudgetAlert(c, spent, budget, true);
    }
    // 80% alert (only if not already over 100%)
    const warnKey = `warn:${c}:${todayKey}`;
    if (pct >= BUDGET_WARN_PCT && pct < 100 && !_shownBudgetAlerts.has(warnKey)) {
      _shownBudgetAlerts.add(warnKey);
      showBudgetAlert(c, spent, budget, false);
    }
  });
}

function showBudgetAlert(cat: string, spent: number, budget: number, over: boolean): void {
  const pct = Math.round((spent / budget) * 100);
  const msg = over
    ? `⚠️ ${cat} budget exceeded! Spent ${sym()}${fmt(spent)} of ${sym()}${fmt(budget)} (${pct}%)`
    : `📊 ${cat} budget at ${pct}% — ${sym()}${fmt(budget - spent)} remaining`;
  showToast(msg);
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
export function renderCalendar(): void {
  try {
    const key = getMonthPicker().value;
    const [y, m] = key.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDay = new Date(y, m - 1, 1).getDay();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;

    const billMap: Record<number, typeof db.bills> = {};
    let total = 0, unpaidBillTotal = 0;

    db.bills.forEach(b => {
      let day = b.day;
      // Skip bills with a missing/invalid day — they'd be invisible on the calendar
      // but would still pollute the total and unpaid-bill KPIs.
      if (!day || isNaN(day) || day < 1) return;
      const shifted = day > daysInMonth;
      if (shifted) { day = daysInMonth; b._shifted = true; } else { b._shifted = false; }
      if (!billMap[day]) billMap[day] = [];
      billMap[day].push(b);
      total += math(b.amount);
      const s = (db.billStatus[key] ?? {})[b.id];
      const isPaid = typeof s === 'object' ? s.paid : !!s;
      if (!isPaid) unpaidBillTotal += math(b.amount);
    });

    const grid = document.getElementById('calendarCells');
    if (!grid) return;
    grid.innerHTML = '';

    for (let i = 0; i < startOffset; i++) {
      grid.insertAdjacentHTML('beforeend', `<div class="calendar-day bg-slate-50/60 dark:bg-slate-900/30"></div>`);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      let billsHtml = '';
      const dayBills = billMap[d] ?? [];
      const visible = dayBills.slice(0, CALENDAR_MAX_CHIPS);
      const overflow = dayBills.length - visible.length;

      visible.forEach(b => {
        const s = (db.billStatus[key] ?? {})[b.id];
        const isPaid = typeof s === 'object' ? s.paid : !!s;
        const cls = isPaid
          ? 'paid bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border-emerald-300'
          : 'unpaid bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300';
        const checkIcon = isPaid ? `<i class="fas fa-check text-emerald-500 mr-1" style="font-size:9px"></i>` : '';
        const shiftTitle = b._shifted ? ` title="Scheduled day ${b.day} — moved to last day of this month"` : '';
        const shiftMark = b._shifted ? ' <span title="Date adjusted" style="font-size:9px">*</span>' : '';
        const statusLabel = isPaid ? 'Paid' : 'Unpaid';
        billsHtml += `<div class="bill-chip ${cls}" data-toggle-bill="${b.id}" tabindex="0" role="button" aria-pressed="${isPaid}" aria-label="${esc(b.name)}: ${sym()}${fmt(b.amount)}, ${statusLabel}. Press to toggle."${shiftTitle}>${checkIcon}<span class="bill-name truncate font-bold">${esc(b.name)}${shiftMark}</span><div class="flex items-center ml-1"><span class="bill-amt money-val">${sym()}${fmt(b.amount)}</span><span class="btn-edit-bill ml-1 text-slate-400 hover:text-indigo-500" data-edit-bill="${b.id}" tabindex="0" role="button" aria-label="Edit ${esc(b.name)}"><i class="fas fa-pencil-alt" style="font-size:9px" aria-hidden="true"></i></span><span class="btn-delete-bill ml-1 text-slate-400 hover:text-rose-500" data-del-bill="${b.id}" tabindex="0" role="button" aria-label="Delete ${esc(b.name)}"><i class="fas fa-times-circle" aria-hidden="true"></i></span></div></div>`;
      });
      if (overflow > 0) billsHtml += `<div class="text-[10px] text-slate-400 font-semibold pl-1 pt-0.5">+${overflow} more</div>`;

      grid.insertAdjacentHTML('beforeend',
        `<div class="calendar-day bg-white dark:bg-slate-900/60"><div class="day-number">${d}</div><div class="flex flex-col gap-1">${billsHtml}</div></div>`);
    }

    setText('calendarMonthLabel', new Date(y, m - 1).toLocaleString('default', { month: 'long', year: 'numeric' }));
    setText('billTotal', `${sym()}${fmt(total)}`);
    const rollover = getRollover(key);
    const txs = db.transactions[key] ?? [];
    const mInc = txs.filter(t => t.type === 'income').reduce((a, t) => a + math(t.amount), 0);
    const mExp = txs.filter(t => t.type === 'expense').reduce((a, t) => a + math(t.amount), 0);
    setText('billSafe', symFmt((mInc + rollover) - mExp - unpaidBillTotal));
  } catch (e) {
    console.error('Calendar error:', e);
  }
}

// ─── Wealth ───────────────────────────────────────────────────────────────────
export function renderWealth(): void {
  try {
    // Consolidate duplicates first
    consolidateWealth();

    const totalAssets = db.wealth.assets.reduce((a, b) => a + math(b.value), 0);
    const totalDebts = db.wealth.debts.reduce((a, b) => a + math(b.value), 0);

    const key = getMonthPicker().value;
    const rollover = getRollover(key);
    const txs = db.transactions[key] ?? [];
    let inc = 0, exp = 0;
    txs.forEach(t => { if (t.type === 'income') inc += math(t.amount); else exp += math(t.amount); });
    const operatingCash = (inc + rollover) - exp;

    const displayTotalAssets = totalAssets + operatingCash;
    const liquidAssets = db.wealth.assets
      .filter(a => ['Savings', 'Cash', 'Investment'].includes(a.type))
      .reduce((a, b) => a + b.value, 0) + operatingCash;

    setText('wealthNet', symFmt(displayTotalAssets - totalDebts));
    setText('wealthTotalAssets', symFmt(displayTotalAssets));
    setText('wealthTotalDebts', `${sym()}${fmt(totalDebts)}`);
    setText('wealthLiquid', symFmt(liquidAssets));

    // Auto-silently snapshot the current month's net worth so history fills in
    // without requiring manual "Log Snapshot" clicks.  Use persistOnly() so it
    // doesn't trigger a recursive render loop.
    const currentNet = displayTotalAssets - totalDebts;
    if (!db.wealth.history) db.wealth.history = {};
    const todayKey = getMonthKey(new Date());
    if (db.wealth.history[todayKey] !== currentNet) {
      db.wealth.history[todayKey] = currentNet;
      persistOnly();
    }

    // History window — 24 months for a richer trajectory view
    const histData = db.wealth.history;
    const chartLabels: string[] = [];
    const chartValues: (number | null)[] = [];
    const histStart = new Date();
    histStart.setMonth(histStart.getMonth() - 23);
    for (let i = 0; i < 24; i++) {
      const lk = `${histStart.getFullYear()}-${String(histStart.getMonth() + 1).padStart(2, '0')}`;
      chartLabels.push(histStart.toLocaleString('default', { month: 'short', year: '2-digit' }));
      chartValues.push(histData[lk] !== undefined ? histData[lk] : null);
      histStart.setMonth(histStart.getMonth() + 1);
    }

    const { avgMonthlyExp, fireTarget, progress, hasData } = calcFireStats(currentNet);
    updateWealthCharts(totalAssets, operatingCash, totalDebts, chartLabels, chartValues, fireTarget);

    setText('wealthFireNumber', `${sym()}${fmt(fireTarget)}`);
    setText('wealthFirePct', `${progress.toFixed(1)}%`);
    const fireBar = document.getElementById('wealthFireBar') as HTMLElement | null;
    if (fireBar) fireBar.style.width = `${progress}%`;
    setText('wealthFireMsg', hasData
      ? `Based on avg spending of ${sym()}${fmt(avgMonthlyExp)}/mo (6-month window)`
      : `Add expense data to calibrate target. (Default: ${sym()}2k/mo)`);

    const listAssets = document.getElementById('listAssets');
    if (listAssets) {
      listAssets.innerHTML = '';
      if (db.wealth.assets.length === 0) {
        listAssets.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">No assets yet — add one above.</p>`;
      } else {
        db.wealth.assets.forEach(item => {
          const tickerBadge = item.ticker
            ? `<span class="text-[9px] font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded ml-1">${esc(item.ticker)}</span>`
            : '';
          const priceAge = item.lastPriceUpdate
            ? `<span class="text-[8px] text-slate-400 ml-1" title="Last updated">${new Date(item.lastPriceUpdate).toLocaleDateString()}</span>`
            : '';
          listAssets.insertAdjacentHTML('beforeend',
            `<div class="wealth-item">
              <span class="font-semibold text-slate-700 dark:text-slate-300 text-xs min-w-0 mr-2 truncate">${esc(item.name)} <span class="text-[9px] text-slate-400 uppercase ml-1">${esc(item.type)}</span>${tickerBadge}${priceAge}</span>
              <div class="flex items-center gap-1 shrink-0 wealth-item-actions">
                <span class="text-emerald-600 text-xs font-bold money-val mr-1">${sym()}${fmt(item.value)}</span>
                <button type="button" data-edit-asset="${item.id}" class="text-slate-400 hover:text-blue-500"><i class="fas fa-pencil-alt text-xs"></i></button>
                <button type="button" data-del-wealth="assets:${item.id}" class="text-slate-400 hover:text-red-500"><i class="fas fa-trash-alt text-xs"></i></button>
              </div>
            </div>`);
        });
      }
    }

    const listDebts = document.getElementById('listDebts');
    if (listDebts) {
      listDebts.innerHTML = '';
      if (db.wealth.debts.length === 0) {
        listDebts.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">No liabilities yet.</p>`;
      } else {
        db.wealth.debts.forEach(item => {
          listDebts.insertAdjacentHTML('beforeend',
            `<div class="wealth-item">
              <span class="font-semibold text-slate-700 dark:text-slate-300 text-xs min-w-0 mr-2 truncate">${esc(item.name)}</span>
              <div class="flex items-center gap-1 shrink-0 wealth-item-actions">
                <span class="text-rose-500 text-xs font-bold money-val mr-1">${sym()}${fmt(item.value)}</span>
                <button type="button" data-edit-debt="${item.id}" class="text-slate-400 hover:text-blue-500"><i class="fas fa-pencil-alt text-xs"></i></button>
                <button type="button" data-del-wealth="debts:${item.id}" class="text-slate-400 hover:text-red-500"><i class="fas fa-trash-alt text-xs"></i></button>
              </div>
            </div>`);
        });
      }
    }
    renderGoals();
    renderDebtPlanner();
  } catch (e) {
    console.error('Wealth render error:', e);
  }
}

// ─── Reports ──────────────────────────────────────────────────────────────────
export function renderReports(): void {
  try {
    const years = new Set([new Date().getFullYear()]);
    Object.keys(db.transactions).forEach(k => {
      if (!isValidMonthKey(k)) return;
      const y = parseInt(k.split('-')[0], 10);
      if (!isNaN(y)) years.add(y);
    });
    const sel = document.getElementById('reportYearSelect') as HTMLSelectElement | null;
    if (!sel) return;

    const prevValue = sel.value;
    sel.innerHTML = '';
    Array.from(years).sort((a, b) => b - a).forEach(y => {
      sel.insertAdjacentHTML('beforeend', `<option value="${y}">${y}</option>`);
    });
    const dashYear = parseInt(getMonthPicker().value.split('-')[0], 10);
    if (prevValue && years.has(Number(prevValue))) sel.value = prevValue;
    else if (years.has(dashYear)) sel.value = String(dashYear);

    const targetYear = sel.value;
    const monthTable = document.getElementById('rptMonthTable');
    if (!monthTable) return;
    monthTable.innerHTML = '';

    const chLabels: string[] = [], chInc: number[] = [], chExp: number[] = [];
    let hasData = false;

    for (let mo = 1; mo <= 12; mo++) {
      const mk = `${targetYear}-${String(mo).padStart(2, '0')}`;
      const txs = db.transactions[mk] ?? [];
      let mInc = 0, mExp = 0;
      txs.forEach(t => { if (t.type === 'income') mInc += math(t.amount); else mExp += math(t.amount); });
      chLabels.push(new Date(Number(targetYear), mo - 1).toLocaleString('default', { month: 'short' }));
      chInc.push(mInc);
      chExp.push(mExp);
      if (mInc > 0 || mExp > 0) {
        hasData = true;
        const net = mInc - mExp;
        const netColor = net >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400';
        monthTable.insertAdjacentHTML('beforeend',
          `<tr class="border-b border-slate-50 dark:border-slate-800">
            <td class="py-3 pl-3 font-medium text-slate-700 dark:text-slate-300">${new Date(Number(targetYear), mo - 1).toLocaleString('default', { month: 'long' })}</td>
            <td class="text-right text-emerald-600 dark:text-emerald-400 money-val">${sym()}${fmt(mInc)}</td>
            <td class="text-right text-rose-600 dark:text-rose-400 money-val">${sym()}${fmt(mExp)}</td>
            <td class="text-right pr-3 font-bold ${netColor} money-val">${symFmt(net)}</td>
          </tr>`);
      }
    }

    if (!hasData) monthTable.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-slate-400 text-xs">No data for ${esc(targetYear)}</td></tr>`;

    updateYearlyChart(chLabels, chInc, chExp);

    // Build per-month category spend map for the trend chart
    const catMonthlyMap: Record<string, number[]> = {};
    for (let mo = 1; mo <= 12; mo++) {
      const mk = `${targetYear}-${String(mo).padStart(2, '0')}`;
      const txs = db.transactions[mk] ?? [];
      txs.forEach(t => {
        if (t.type !== 'expense') return;
        if (t.splits && t.splits.length > 0) {
          t.splits.forEach((s: { category: string; amount: number }) => {
            if (!catMonthlyMap[s.category]) catMonthlyMap[s.category] = Array(12).fill(0);
            catMonthlyMap[s.category][mo - 1] += math(s.amount);
          });
        } else {
          if (!catMonthlyMap[t.category]) catMonthlyMap[t.category] = Array(12).fill(0);
          catMonthlyMap[t.category][mo - 1] += math(t.amount);
        }
      });
    }
    updateCategoryTrendChart(chLabels, catMonthlyMap);
  } catch (e) {
    console.error('Report render error:', e);
  }
}

// ─── Goals ────────────────────────────────────────────────────────────────────
export function renderGoals(): void {
  const list = document.getElementById('listGoals');
  if (!list) return;
  list.innerHTML = '';
  if (!db.goals || db.goals.length === 0) {
    list.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">No goals yet — add one above.</p>';
    return;
  }
  db.goals.forEach(g => {
    const pct   = g.target > 0 ? Math.min(Math.max((g.current / g.target) * 100, 0), 100) : 0;
    const remaining = Math.max(0, g.target - g.current);
    const color = pct >= 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-indigo-500' : 'bg-amber-500';
    let deadlineHtml = '';
    if (g.deadline) {
      const dlDate  = new Date(g.deadline + 'T00:00:00');
      const daysLeft = Math.ceil((dlDate.getTime() - Date.now()) / 86_400_000);
      const dlColor  = pct >= 100 ? 'text-emerald-500' : daysLeft < 0 ? 'text-rose-500' : daysLeft <= 30 ? 'text-amber-500' : 'text-slate-400';
      const dlLabel  = pct >= 100 ? 'Goal reached!' : daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`;
      deadlineHtml = `<span class="text-[10px] font-medium ${dlColor} ml-1"><i class="far fa-calendar-alt mr-0.5"></i>${esc(dlLabel)}</span>`;
    }

    // Quick-contribute inline form (shown when this goal is active)
    const showContrib = _contribGoalId === g.id && pct < 100;
    const contribHtml = showContrib
      ? `<div class="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
           <span class="curr-prefix text-xs text-slate-400 font-semibold">${sym()}</span>
           <input id="contribInput-${g.id}" type="number" min="0.01" step="0.01" max="${remaining}"
             placeholder="Amount to add" autofocus
             class="flex-1 p-1.5 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-white outline-none focus:ring-2 focus:ring-indigo-300">
           <button type="button" data-do-contrib="${g.id}"
             class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition">Add</button>
           <button type="button" data-cancel-contrib="${g.id}"
             class="text-xs text-slate-400 hover:text-rose-500 font-bold">✕</button>
         </div>`
      : '';

    list.insertAdjacentHTML('beforeend',
      `<div class="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg mb-2">
        <div class="flex justify-between items-start mb-1">
          <div class="flex-1 min-w-0">
            <span class="font-bold text-slate-700 dark:text-slate-200 text-xs">${esc(g.name)}</span>
            ${g.notes ? `<span class="text-[10px] text-slate-400 ml-2">${esc(g.notes)}</span>` : ''}
            ${deadlineHtml}
          </div>
          <div class="flex gap-1.5 items-center shrink-0 ml-2">
            <span class="text-xs text-slate-500 money-val">${sym()}${fmt(g.current)} / ${sym()}${fmt(g.target)}</span>
            ${pct < 100
              ? `<button type="button" data-contrib-goal="${g.id}"
                   title="Add contribution"
                   class="text-emerald-500 hover:text-emerald-400 font-bold px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-[10px] transition">+</button>`
              : ''}
            <button type="button" data-edit-goal="${g.id}" class="text-slate-400 hover:text-indigo-500"><i class="fas fa-pencil-alt" style="font-size:10px"></i></button>
            <button type="button" data-del-goal="${g.id}" class="text-slate-400 hover:text-rose-500"><i class="fas fa-times" style="font-size:10px"></i></button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div class="h-full ${color} rounded-full transition-all" style="width:${pct}%"></div>
          </div>
          <span class="text-[10px] font-bold text-slate-400 shrink-0">${Math.round(pct)}%</span>
        </div>
        ${contribHtml}
      </div>`);
  });
}

// ─── Dropdowns ───────────────────────────────────────────────────────────────
export function renderDropdowns(): void {
  const sel = document.getElementById('txCat') as HTMLSelectElement | null;
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '';
    db.categories.forEach(c => sel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));
    sel.insertAdjacentHTML('beforeend', `<option value="ADD_NEW">+ New Category...</option>`);
    if (db.categories.includes(cur)) sel.value = cur;
  }

  const filter = document.getElementById('txCatFilter') as HTMLSelectElement | null;
  if (filter) {
    const cf = filter.value;
    filter.innerHTML = '<option value="">All Categories</option>';
    db.categories.forEach(c => filter.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));
    if (db.categories.includes(cf)) filter.value = cf;
  }

  const recCat = document.getElementById('recCat') as HTMLSelectElement | null;
  if (recCat) {
    recCat.innerHTML = '';
    db.categories.forEach(c => recCat.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));
  }

  const billCat = document.getElementById('billCat') as HTMLSelectElement | null;
  if (billCat) {
    const bc = billCat.value;
    billCat.innerHTML = '';
    db.categories.forEach(c => billCat.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));
    if (db.categories.includes(bc)) billCat.value = bc;
    else billCat.value = 'Bills';
  }

  // Bulk recategorise select — populated with the same category list
  const bulkCat = document.getElementById('bulkCatSel') as HTMLSelectElement | null;
  if (bulkCat) {
    const bv = bulkCat.value;
    bulkCat.innerHTML = '<option value="">Pick category…</option>';
    db.categories.forEach(c => bulkCat.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));
    if (db.categories.includes(bv)) bulkCat.value = bv;
  }

  // Phase 5A: account selectors — tx form, filter, instalment form
  const accountSelectors = ['txAccount', 'instAccount'];
  accountSelectors.forEach(id => {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (!el) return;
    const prev = el.value;
    el.innerHTML = '<option value="">No account</option>';
    db.accounts.forEach(a => el.insertAdjacentHTML('beforeend', `<option value="${esc(a)}">${esc(a)}</option>`));
    if (db.accounts.includes(prev)) el.value = prev;
  });

  // Account filter dropdown
  const acctFilter = document.getElementById('txAccountFilter') as HTMLSelectElement | null;
  if (acctFilter) {
    const prev = acctFilter.value;
    acctFilter.innerHTML = '<option value="">All accounts</option>';
    db.accounts.forEach(a => acctFilter.insertAdjacentHTML('beforeend', `<option value="${esc(a)}">${esc(a)}</option>`));
    if (db.accounts.includes(prev)) acctFilter.value = prev;
  }

  // Instalment category selector
  const instCat = document.getElementById('instCat') as HTMLSelectElement | null;
  if (instCat) {
    const prev = instCat.value;
    instCat.innerHTML = '';
    db.categories.forEach(c => instCat.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));
    if (db.categories.includes(prev)) instCat.value = prev;
    else if (db.categories.includes('Bills')) instCat.value = 'Bills';
  }
}

// ─── Accounts ────────────────────────────────────────────────────────────────
export function renderAccounts(): void {
  const list = document.getElementById('accountList');
  if (!list) return;
  list.innerHTML = '';
  if (!db.accounts || db.accounts.length === 0) {
    list.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">No accounts yet.</p>';
    return;
  }
  db.accounts.forEach(name => {
    const txCount = Object.values(db.transactions).flat().filter(t => t.account === name).length;
    list.insertAdjacentHTML('beforeend',
      `<div class="flex items-center justify-between bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-lg text-xs mb-1">
        <div>
          <span class="font-bold text-slate-700 dark:text-slate-200">${esc(name)}</span>
          <span class="text-slate-400 ml-2">${txCount} tx</span>
        </div>
        ${db.accounts.length > 1
          ? `<button type="button" data-del-account="${esc(name)}"
               class="text-slate-400 hover:text-rose-500 transition ml-2" title="Remove account">
               <i class="fas fa-times text-[10px]"></i>
             </button>`
          : ''}
      </div>`);
  });
}

// ─── Settings categories ──────────────────────────────────────────────────────
export function renderSettingsCats(): void {
  const div = document.getElementById('settingsCatList');
  if (!div) return;
  div.innerHTML = '';
  db.categories.forEach(c => {
    if (c === 'Bills') return;
    const chip = document.createElement('div');
    chip.className = 'px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-xs flex items-center gap-2 border dark:border-slate-700 dark:text-slate-300';
    chip.innerHTML = `${esc(c)} <span data-del-cat="${esc(c)}" class="cursor-pointer text-slate-400 hover:text-rose-500">&times;</span>`;
    div.appendChild(chip);
  });
}

// ─── Recurring list ───────────────────────────────────────────────────────────
export function renderRecurring(): void {
  const list = document.getElementById('recurringList');
  if (!list) return;
  list.innerHTML = '';
  if (!db.recurring || db.recurring.length === 0) {
    list.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">No templates yet. Add one above.</p>';
    return;
  }
  db.recurring.forEach(r => {
    const sign = r.type === 'income' ? '+' : '-';
    const col = r.type === 'income' ? 'text-emerald-600' : 'text-rose-600';
    list.insertAdjacentHTML('beforeend',
      `<div class="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-2 rounded-lg text-xs">
        <div><span class="font-bold text-slate-700 dark:text-slate-200">${esc(r.desc)}</span> <span class="text-slate-400 dark:text-slate-500 ml-1">${esc(r.category)}</span></div>
        <div class="flex items-center gap-2">
          <span class="font-bold ${col}">${sign}${sym()}${fmt(r.amount)}</span>
          <button type="button" data-del-recurring="${r.id}" class="text-slate-400 hover:text-rose-500 transition"><i class="fas fa-times"></i></button>
        </div>
      </div>`);
  });
}

// ─── Smart Recurring Suggestions ─────────────────────────────────────────────
export function renderRecurringSuggestions(): void {
  const container = document.getElementById('recurringSuggestions');
  if (!container) return;
  const candidates = detectRecurringCandidates();
  if (candidates.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  // Show top 5 suggestions
  const top = candidates.slice(0, 5);
  container.innerHTML = `
    <div class="card bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 max-w-md mb-6">
      <h3 class="font-bold text-amber-800 dark:text-amber-300 mb-1 flex items-center gap-2">
        <i class="fas fa-lightbulb"></i> Suggested Recurring Templates
      </h3>
      <p class="text-xs text-amber-700 dark:text-amber-400 mb-4">These expenses appear in ${top[0].monthsCount}+ months. Add them as recurring templates for auto-apply.</p>
      <div class="space-y-2" id="suggestionList">
        ${top.map(c => `
          <div class="flex items-center justify-between bg-white dark:bg-slate-800 rounded-xl px-3 py-2 text-xs">
            <div class="flex-1 min-w-0">
              <span class="font-semibold text-slate-700 dark:text-slate-200 truncate block">${esc(c.desc)}</span>
              <span class="text-slate-400">${esc(c.category)} · seen ${c.monthsCount}×</span>
            </div>
            <div class="flex items-center gap-2 ml-2">
              <span class="font-bold text-rose-600 dark:text-rose-400">${sym()}${fmt(c.amount)}</span>
              <button type="button"
                data-accept-suggestion="${encodeURIComponent(c.desc)}|${encodeURIComponent(String(c.amount))}|${encodeURIComponent(c.category)}"
                class="bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded-lg font-bold transition text-[10px] whitespace-nowrap">
                + Add
              </button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ─── Upcoming bills widget ────────────────────────────────────────────────────
export function renderUpcomingBills(): void {
  const widget = document.getElementById('upcomingBillsWidget');
  const list = document.getElementById('upcomingBillsList');
  if (!widget || !list) return;

  const today = new Date();
  const key = getMonthPicker().value;
  const currentMonthKey = getMonthKey(today);
  if (key !== currentMonthKey) { widget.classList.add('hidden'); return; }

  const [y, m] = key.split('-').map(Number);
  const upcoming: (typeof db.bills[0] & { daysUntil: number })[] = [];

  db.bills.forEach(b => {
    const day = Math.min(b.day, new Date(y, m, 0).getDate());
    const billDate = new Date(y, m - 1, day);
    const daysUntil = Math.ceil((billDate.getTime() - today.getTime()) / 86_400_000);
    const s = (db.billStatus[key] ?? {})[b.id];
    const isPaid = typeof s === 'object' ? s.paid : !!s;
    if (!isPaid && daysUntil >= 0 && daysUntil <= 7) upcoming.push({ ...b, daysUntil });
  });

  if (upcoming.length > 0) {
    widget.classList.remove('hidden');
    list.innerHTML = '';

    // ─── Bill Shock Radar ─────────────────────────────────────────────────────
    // Compute available cash: current month net (inc - exp) + any liquid assets
    const txs = db.transactions[key] ?? [];
    let mInc = 0, mExp = 0;
    txs.forEach(t => { if (t.type === 'income') mInc += math(t.amount); else mExp += math(t.amount); });
    const liquidAssets = db.wealth.assets.filter(a => a.type === 'Cash' || a.type === 'Savings').reduce((s, a) => s + math(a.value), 0);
    const availableCash = mInc - mExp + liquidAssets;
    const totalUpcoming = upcoming.reduce((s, b) => s + b.amount, 0);
    const cashPressure = availableCash > 0 && totalUpcoming > 0 && availableCash < totalUpcoming * 1.2;

    if (cashPressure) {
      list.insertAdjacentHTML('beforeend',
        `<div class="flex items-center gap-2 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-3 py-2 rounded-lg text-xs font-bold mb-1" role="alert">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Bill shock alert — upcoming bills (<span class="money-val">${sym()}${fmt(totalUpcoming)}</span>) are close to your available cash (<span class="money-val">${sym()}${fmt(availableCash)}</span>)</span>
        </div>`);
    }

    upcoming.sort((a, b) => a.daysUntil - b.daysUntil).forEach(b => {
      const label = b.daysUntil === 0 ? 'Today' : b.daysUntil === 1 ? 'Tomorrow' : `In ${b.daysUntil}d`;
      const urgent = cashPressure && b.daysUntil <= 2;
      const chipClass = urgent
        ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300'
        : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300';
      const badgeClass = urgent ? 'bg-rose-200 dark:bg-rose-800' : 'bg-amber-200 dark:bg-amber-800';
      list.insertAdjacentHTML('beforeend',
        `<div class="flex items-center gap-2 ${chipClass} px-3 py-1.5 rounded-lg text-xs font-bold">
          <i class="fas fa-clock"></i>${esc(b.name)} <span class="font-normal money-val">${sym()}${fmt(b.amount)}</span>
          <span class="text-[9px] uppercase ${badgeClass} px-1.5 py-0.5 rounded-full">${esc(label)}</span>
        </div>`);
    });
  } else {
    widget.classList.add('hidden');
  }
}

// ─── Debt Payoff Planner ──────────────────────────────────────────────────────
export function renderDebtPlanner(): void {
  const container = document.getElementById('debtPlanner');
  if (!container) return;

  if (db.wealth.debts.filter(d => math(d.value) > 0).length === 0) {
    container.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-bold text-slate-800 dark:text-white">Debt Payoff Simulator</h3>
      </div>
      <p class="text-xs text-slate-400 text-center py-4">Add liabilities with a balance to see payoff projections.</p>`;
    return;
  }

  const plans = getDebtPayoffPlans({ strategy: _debtStrategy, extraPayment: _debtExtra });
  const cmp   = compareDebtStrategies(_debtExtra);
  const interestSaved = math(cmp.snowball.totalInterest - cmp.avalanche.totalInterest);
  const monthsSaved   = cmp.snowball.totalMonths - cmp.avalanche.totalMonths;

  const isAvalanche = _debtStrategy === 'avalanche';

  const rows = plans.map(p => {
    const never   = p.monthsToPayoff <= 0;
    const yr      = Math.floor(p.monthsToPayoff / 12);
    const mo      = p.monthsToPayoff % 12;
    const timeStr = never ? '∞' : yr > 0 ? `${yr}y ${mo}m` : `${mo}m`;
    return `
      <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-bold text-sm text-slate-800 dark:text-slate-200 truncate">${esc(p.name)}</span>
            ${p.annualRate > 0
              ? `<span class="shrink-0 text-[10px] font-bold bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded">${p.annualRate}% APR</span>`
              : '<span class="shrink-0 text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded">0% interest</span>'}
          </div>
          <div class="text-[10px] text-slate-500 mt-1">
            Balance: <span class="font-semibold money-val">${symFmt(p.balance)}</span>
            ${p.monthlyPayment > 0 ? `&nbsp;·&nbsp;Payment: <span class="font-semibold money-val">${symFmt(p.monthlyPayment)}/mo</span>` : ''}
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-base font-bold ${never ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200'}">${timeStr}</div>
          ${!never && p.totalInterest > 0
            ? `<div class="text-[10px] text-rose-400 money-val">${symFmt(p.totalInterest)} interest</div>`
            : never ? '<div class="text-[10px] text-rose-400">Increase payment!</div>' : ''}
          <div class="text-[10px] text-slate-400">${esc(p.payoffDateStr)}</div>
        </div>
      </div>`;
  }).join('');

  // Avalanche advantage badge
  const advBadge = interestSaved > 0
    ? `<span class="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold">
        Avalanche saves ${sym()}${fmt(interestSaved)} interest${monthsSaved > 0 ? ` &amp; ${monthsSaved}mo` : ''}
       </span>`
    : '';

  container.innerHTML = `
    <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
      <h3 class="font-bold text-slate-800 dark:text-white">Debt Payoff Simulator</h3>
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 gap-0.5">
          <button type="button" data-debt-strategy="avalanche"
            class="px-3 py-1.5 rounded-md text-xs font-bold transition ${isAvalanche ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}">
            ⛰ Avalanche
          </button>
          <button type="button" data-debt-strategy="snowball"
            class="px-3 py-1.5 rounded-md text-xs font-bold transition ${!isAvalanche ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}">
            ❄ Snowball
          </button>
        </div>
        <div class="flex items-center gap-1">
          <span class="curr-prefix text-xs text-slate-400 font-semibold">${sym()}</span>
          <input id="debtExtraInput" type="number" min="0" step="10" placeholder="Extra/mo"
            value="${_debtExtra > 0 ? _debtExtra : ''}"
            class="w-24 p-1.5 text-xs border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-300 outline-none">
        </div>
      </div>
    </div>
    ${advBadge ? `<div class="mb-3">${advBadge}</div>` : ''}
    <div class="space-y-2 mb-4">${rows}</div>
    <div class="debt-timeline-wrap mt-4" style="${plans.filter(p => p.monthsToPayoff > 0).length === 0 ? 'display:none' : ''}">
      <p class="text-[10px] font-bold uppercase text-slate-400 mb-2">Time to Payoff</p>
      <div style="height:${Math.max(60, plans.filter(p => p.monthsToPayoff > 0).length * 36)}px">
        <canvas id="chartDebtTimeline"></canvas>
      </div>
    </div>`;

  // Draw the timeline chart after the canvas is in the DOM
  updateDebtTimelineChart(plans);
}

// ─── Insights view ────────────────────────────────────────────────────────────
export function renderInsights(): void {
  try {
    renderSpendingHeatmap();

    const key = getMonthPicker().value;

    // Net worth (needed for runway + health score)
    const totalAssets = db.wealth.assets.reduce((a, b) => a + math(b.value), 0);
    const totalDebts  = db.wealth.debts.reduce((a, b) => a + math(b.value), 0);
    const txs = db.transactions[key] ?? [];
    let mInc = 0, mExp = 0;
    txs.forEach(t => { if (t.type === 'income') mInc += math(t.amount); else mExp += math(t.amount); });
    const rollover = getRollover(key);
    const netWorth = totalAssets + (mInc + rollover - mExp) - totalDebts;
    const { fireTarget } = calcFireStats(netWorth);

    // ─ Health score ───────────────────────────────────────────────────────────
    const health = getHealthScore(key, netWorth, fireTarget);
    const healthScoreEl = document.getElementById('insHealthScore');
    if (healthScoreEl) {
      healthScoreEl.textContent = String(health.total);
      healthScoreEl.className = `text-5xl font-extrabold ${
        health.total >= 75 ? 'text-emerald-400' :
        health.total >= 50 ? 'text-amber-400' : 'text-rose-400'}`;
    }
    const healthLabelEl = document.getElementById('insHealthLabel');
    if (healthLabelEl) {
      healthLabelEl.textContent =
        health.total >= 75 ? '✓ Excellent financial health' :
        health.total >= 50 ? '~ Good — room to improve' :
                             '! Needs attention';
    }
    const breakdownEl = document.getElementById('insHealthBreakdown');
    if (breakdownEl) {
      const items = [
        { label: 'Savings rate',     val: health.savings, max: 40 },
        { label: 'Budget adherence', val: health.budget,  max: 30 },
        { label: '6-mo runway',      val: health.runway,  max: 20 },
        { label: 'FIRE progress',    val: health.fire,    max: 10 },
      ];
      breakdownEl.innerHTML = items.map(({ label, val, max }) => `
        <div>
          <div class="flex justify-between text-[10px] text-slate-400 mb-0.5">
            <span>${label}</span><span class="font-bold">${val}/${max}</span>
          </div>
          <div class="w-full bg-slate-700 rounded-full h-1.5">
            <div class="bg-indigo-400 h-1.5 rounded-full" style="width:${Math.round((val / max) * 100)}%"></div>
          </div>
        </div>`).join('');
    }

    // ─ KPI cards ──────────────────────────────────────────────────────────────
    const dailyBurn = getDailyBurnRate(key);
    const forecast  = getMonthEndForecast(key);
    const runway    = getCashRunway(netWorth, key);
    setText('insDailyBurn', `${sym()}${fmt(dailyBurn)}`);
    setText('insForecast',  `${sym()}${fmt(forecast)}`);
    const insRunwayEl = document.getElementById('insRunway');
    if (insRunwayEl) {
      insRunwayEl.textContent = (!isFinite(runway) || runway > 999) ? '999+ mo' : `${runway.toFixed(1)} mo`;
      insRunwayEl.className = `text-2xl font-bold mt-1 ${
        runway >= 6 ? 'text-teal-600 dark:text-teal-400' :
        runway >= 3 ? 'text-amber-600 dark:text-amber-400' :
                      'text-rose-600 dark:text-rose-400'}`;
    }

    // ─ Spending velocity grid ─────────────────────────────────────────────────
    const velocity      = getSpendingVelocity(key);
    const velocityGrid  = document.getElementById('insVelocityGrid');
    const velocityEmpty = document.getElementById('insVelocityEmpty');
    const withData      = velocity.filter(v => v.current > 0 || v.avg > 0);

    if (velocityGrid && velocityEmpty) {
      if (withData.length === 0) {
        velocityGrid.classList.add('hidden');
        velocityEmpty.classList.remove('hidden');
      } else {
        velocityGrid.classList.remove('hidden');
        velocityEmpty.classList.add('hidden');
        velocityGrid.innerHTML = withData.map(v => {
          const isUp    = v.diff > 0;
          const isNew   = v.avg === 0 && v.current > 0;
          const colorCls = isUp ? 'text-rose-600 dark:text-rose-400'
                                : 'text-emerald-600 dark:text-emerald-400';
          const bgCls   = isNew ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/30'
                        : isUp  ? 'bg-rose-50 dark:bg-rose-900/10 border-rose-100 dark:border-rose-900/30'
                                 : 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900/30';
          const arrow   = isNew ? '<span class="text-amber-500 text-[10px] font-bold">NEW</span>'
                        : isUp  ? '<i class="fas fa-arrow-up text-rose-500 text-[10px]"></i>'
                                 : '<i class="fas fa-arrow-down text-emerald-500 text-[10px]"></i>';
          const pctStr  = isNew ? '' : `${isUp ? '+' : ''}${v.pct.toFixed(0)}%`;
          return `
            <div class="p-3 rounded-xl border ${bgCls}">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">${esc(v.category)}</span>
                <div class="flex items-center gap-1 text-xs font-bold ${colorCls} shrink-0 ml-1">${arrow} ${pctStr}</div>
              </div>
              <div class="text-lg font-bold text-slate-800 dark:text-white money-val">${symFmt(v.current)}</div>
              ${v.avg > 0 ? `<div class="text-[10px] text-slate-500 mt-0.5 money-val">Avg: ${symFmt(v.avg)}</div>` : ''}
            </div>`;
        }).join('');
      }
    }

    // ─ Top movers ─────────────────────────────────────────────────────────────
    const movers  = velocity.filter(v => v.avg > 0);
    const topUp   = [...movers].sort((a, b) => b.diff - a.diff).slice(0, 3).filter(v => v.diff > 0);
    const topDown = [...movers].sort((a, b) => a.diff - b.diff).slice(0, 3).filter(v => v.diff < 0);

    const renderMover = (v: VelocityEntry, up: boolean) => {
      const sign  = up ? '+' : '';
      const color = up ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400';
      return `
        <div class="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
          <div>
            <span class="text-sm font-bold text-slate-700 dark:text-slate-300">${esc(v.category)}</span>
            <div class="text-[10px] text-slate-400 money-val">${symFmt(v.current)} vs ${symFmt(v.avg)} avg</div>
          </div>
          <span class="text-sm font-bold ${color} money-val">${sign}${symFmt(Math.abs(v.diff))}</span>
        </div>`;
    };

    const topUpEl    = document.getElementById('insTopUp');
    const topUpEmpty = document.getElementById('insTopUpEmpty');
    if (topUpEl && topUpEmpty) {
      topUpEmpty.classList.toggle('hidden', topUp.length > 0);
      topUpEl.innerHTML = topUp.map(v => renderMover(v, true)).join('');
    }
    const topDownEl    = document.getElementById('insTopDown');
    const topDownEmpty = document.getElementById('insTopDownEmpty');
    if (topDownEl && topDownEmpty) {
      topDownEmpty.classList.toggle('hidden', topDown.length > 0);
      topDownEl.innerHTML = topDown.map(v => renderMover(v, false)).join('');
    }

    // ─ Savings momentum (last 7 months mini bar chart) ────────────────────────
    const savingsMomentumEl = document.getElementById('insSavingsMomentum');
    if (savingsMomentumEl) {
      const recentKeys = [...getRecentMonthKeys(key, 6), key];
      savingsMomentumEl.innerHTML = recentKeys.map(k => {
        const arr = db.transactions[k] ?? [];
        let ki = 0, ke = 0;
        arr.forEach(t => { if (t.type === 'income') ki += math(t.amount); else ke += math(t.amount); });
        const rate      = ki > 0 ? ((ki - ke) / ki) * 100 : 0;
        const monthName = new Date(k + '-01').toLocaleDateString('default', { month: 'short', year: '2-digit' });
        const barColor  = rate >= 20 ? 'bg-emerald-500' : rate >= 0 ? 'bg-amber-400' : 'bg-rose-500';
        const barWidth  = Math.min(Math.abs(rate), 100);
        const rateColor = rate >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500';
        return `
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-slate-500 w-12 shrink-0">${monthName}</span>
            <div class="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
              <div class="${barColor} h-2 rounded-full transition-all duration-700" style="width:${barWidth}%"></div>
            </div>
            <span class="text-[10px] font-bold w-10 text-right ${rateColor}">${rate.toFixed(0)}%</span>
          </div>`;
      }).join('');
    }
    // ─ Smart financial tips ───────────────────────────────────────────────────
    const tipsEl = document.getElementById('insSmartTips');
    if (tipsEl) {
      const tips = getSmartTips(key, netWorth, fireTarget);
      if (tips.length === 0) {
        tipsEl.innerHTML = `<p class="text-sm text-slate-400 text-center py-4"><i class="fas fa-check-circle text-emerald-400 mr-2"></i>All looks great — no action items right now.</p>`;
      } else {
        const typeStyles: Record<string, string> = {
          warning:     'border-l-4 border-l-rose-500 bg-rose-50 dark:bg-rose-900/10',
          info:        'border-l-4 border-l-sky-500 bg-sky-50 dark:bg-sky-900/10',
          success:     'border-l-4 border-l-emerald-500 bg-emerald-50 dark:bg-emerald-900/10',
          opportunity: 'border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-900/10',
        };
        const iconStyles: Record<string, string> = {
          warning:     'text-rose-500',
          info:        'text-sky-500',
          success:     'text-emerald-500',
          opportunity: 'text-amber-500',
        };
        tipsEl.innerHTML = tips.map(tip => `
          <div class="rounded-xl p-4 ${typeStyles[tip.type] ?? ''}">
            <div class="flex gap-3">
              <div class="shrink-0 mt-0.5"><i class="${esc(tip.icon)} ${iconStyles[tip.type] ?? ''}"></i></div>
              <div>
                <p class="text-sm font-bold text-slate-800 dark:text-white mb-0.5">${esc(tip.title)}</p>
                <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">${esc(tip.body)}</p>
              </div>
            </div>
          </div>`).join('');
      }
    }

    // ─ Achievements ───────────────────────────────────────────────────────────
    const achievementsEl = document.getElementById('insAchievements');
    if (achievementsEl) {
      const achievements = getAchievements(key, netWorth, fireTarget);
      achievementsEl.innerHTML = achievements.map(a => {
        const earnedClass = a.earned
          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 opacity-50';
        return `
          <div class="flex flex-col items-center gap-1 p-3 rounded-xl ${earnedClass} transition" title="${esc(a.desc)}">
            <i class="${esc(a.icon)} text-xl mb-1"></i>
            <span class="text-[10px] font-bold text-center leading-tight">${esc(a.title)}</span>
          </div>`;
      }).join('');
    }

    // ─ Subscription management ────────────────────────────────────────────────
    const subsEl    = document.getElementById('insSubscriptions');
    const subsEmpty = document.getElementById('insSubscriptionsEmpty');
    const subsTotalEl = document.getElementById('insSubsTotal');
    if (subsEl && subsEmpty) {
      const subs = detectSubscriptions();
      const currentMonthKey = key;
      const twoMonthsAgo = (() => {
        const [y, m] = key.split('-').map(Number);
        const d = new Date(y, m - 3, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })();

      if (subs.length === 0) {
        subsEl.classList.add('hidden');
        subsEmpty.classList.remove('hidden');
        if (subsTotalEl) subsTotalEl.classList.add('hidden');
      } else {
        subsEl.classList.remove('hidden');
        subsEmpty.classList.add('hidden');
        const monthlyTotal = subs.reduce((s, sub) => s + math(sub.amount), 0);
        if (subsTotalEl) {
          subsTotalEl.classList.remove('hidden');
          subsTotalEl.innerHTML = `
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div>
                <span class="text-xs text-slate-500">Monthly total</span>
                <span class="ml-2 text-sm font-bold text-slate-800 dark:text-white money-val">${symFmt(monthlyTotal)}</span>
              </div>
              <div>
                <span class="text-xs text-slate-500">Annual projection</span>
                <span class="ml-2 text-sm font-bold text-rose-600 dark:text-rose-400 money-val">${symFmt(math(monthlyTotal * 12))}</span>
              </div>
              <span class="text-[10px] bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 rounded-full px-2 py-0.5 font-bold">${subs.length} detected</span>
            </div>`;
        }
        subsEl.innerHTML = subs.map(sub => {
          const isDormant = sub.months[sub.months.length - 1] < twoMonthsAgo;
          const dormantBadge = isDormant
            ? `<span class="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">INACTIVE</span>`
            : '';
          const monthsLabel = sub.months.slice(-3).map(m => new Date(m + '-01').toLocaleDateString('default', { month: 'short', year: '2-digit' })).join(', ');
          return `
            <div class="flex items-center justify-between py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1 flex-wrap">
                  <span class="text-sm font-semibold text-slate-800 dark:text-white truncate">${esc(sub.desc)}</span>
                  ${dormantBadge}
                </div>
                <div class="text-[10px] text-slate-400 mt-0.5">${esc(sub.category)} · ${sub.monthsCount} months · last seen: ${monthsLabel}</div>
              </div>
              <div class="ml-3 text-right shrink-0">
                <div class="text-sm font-bold text-slate-800 dark:text-white money-val">${symFmt(sub.amount)}/mo</div>
                <div class="text-[10px] text-slate-400 money-val">${symFmt(math(sub.amount * 12))}/yr</div>
              </div>
            </div>`;
        }).join('');
      }
    }
  } catch (e) {
    console.error('Insights render error:', e);
  }
}
