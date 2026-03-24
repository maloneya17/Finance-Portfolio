import { db, save } from './db';
import { showToast } from './toast';
import { math, fmt, esc, sym, symFmt, getMonthKey } from './utils';
import { BUDGET_WARN_PCT, CALENDAR_MAX_CHIPS } from './constants';
import { updateDashboardCharts, updateYearlyChart, updateWealthCharts, calcFireStats } from './charts';
import { getMonthPicker } from './main';
import {
  getRollover, getCurrentCats, consolidateWealth, isValidMonthKey,
  getSpendingVelocity, getDailyBurnRate, getMonthEndForecast,
  getCashRunway, getDebtPayoffPlans, getHealthScore, getRecentMonthKeys,
  type VelocityEntry,
} from './finance';

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
      const matchFrom   = !dateFrom || txDate >= dateFrom;
      const matchTo     = !dateTo   || txDate <= dateTo;
      const matchAmt    = (amtMin === null || t.amount >= amtMin) && (amtMax === null || t.amount <= amtMax);
      return matchSearch && matchCat && matchFrom && matchTo && matchAmt;
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

    // ─ Second-row KPIs: daily burn, month-end projection, cash runway ─────────
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

    if (!document.getElementById('view-dashboard')?.classList.contains('hidden')) {
      updateDashboardCharts(cats);
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

  const cats = getCurrentCats(getMonthPicker().value);
  const barsDiv = document.getElementById('budgetBars');
  if (barsDiv) {
    barsDiv.innerHTML = '';
    let hasBudget = false;
    const [bmy, bmm] = getMonthPicker().value.split('-').map(Number);
    setText('budgetMonthLabel', new Date(bmy, bmm - 1).toLocaleString('default', { month: 'long', year: 'numeric' }));
    Object.keys(db.budgets).forEach(c => {
      const budget = db.budgets[c];
      if (budget > 0) {
        hasBudget = true;
        const spent = cats[c] ?? 0;
        const pct = Math.min((spent / budget) * 100, 100);
        let color = 'bg-emerald-500', statusLabel = 'On budget', statusClass = 'text-emerald-600 dark:text-emerald-400';
        if (pct > BUDGET_WARN_PCT) { color = 'bg-amber-500'; statusLabel = 'Approaching limit'; statusClass = 'text-amber-600 dark:text-amber-400'; }
        if (pct >= 100) { color = 'bg-rose-500'; statusLabel = 'Over budget'; statusClass = 'text-rose-600 dark:text-rose-400'; }
        barsDiv.insertAdjacentHTML('beforeend',
          `<div>
            <div class="flex justify-between items-end mb-1">
              <span class="font-bold text-sm text-slate-700 dark:text-slate-200">${esc(c)}</span>
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
      grid.insertAdjacentHTML('beforeend', `<div class="bg-slate-100 dark:bg-slate-900 min-h-[130px]"></div>`);
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
        billsHtml += `<div class="bill-chip ${cls}" data-toggle-bill="${b.id}"${shiftTitle}>${checkIcon}<span class="bill-name truncate font-bold">${esc(b.name)}${shiftMark}</span><div class="flex items-center ml-1"><span class="bill-amt money-val">${sym()}${fmt(b.amount)}</span><span class="btn-edit-bill ml-1 text-slate-400 hover:text-indigo-500" data-edit-bill="${b.id}"><i class="fas fa-pencil-alt" style="font-size:9px"></i></span><span class="btn-delete-bill ml-1 text-slate-400 hover:text-rose-500" data-del-bill="${b.id}"><i class="fas fa-times-circle"></i></span></div></div>`;
      });
      if (overflow > 0) billsHtml += `<div class="text-[9px] text-slate-400 font-bold pl-1">+${overflow} more</div>`;

      grid.insertAdjacentHTML('beforeend',
        `<div class="calendar-day bg-white dark:bg-slate-900/50 border-b border-r border-slate-200 dark:border-slate-800"><div class="day-number text-slate-400 dark:text-slate-500">${d}</div><div class="flex flex-col gap-1">${billsHtml}</div></div>`);
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

    const totalAssets = db.wealth.assets.reduce((a, b) => a + b.value, 0);
    const totalDebts = db.wealth.debts.reduce((a, b) => a + b.value, 0);

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

    // History window
    const histData = db.wealth.history ?? {};
    const chartLabels: string[] = [];
    const chartValues: (number | null)[] = [];
    const histStart = new Date();
    histStart.setMonth(histStart.getMonth() - 11);
    for (let i = 0; i < 12; i++) {
      const lk = `${histStart.getFullYear()}-${String(histStart.getMonth() + 1).padStart(2, '0')}`;
      chartLabels.push(histStart.toLocaleString('default', { month: 'short', year: '2-digit' }));
      chartValues.push(histData[lk] !== undefined ? histData[lk] : null);
      histStart.setMonth(histStart.getMonth() + 1);
    }

    updateWealthCharts(totalAssets, operatingCash, totalDebts, chartLabels, chartValues);

    const currentNet = displayTotalAssets - totalDebts;
    const { avgMonthlyExp, fireTarget, progress, hasData } = calcFireStats(currentNet);

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
          listAssets.insertAdjacentHTML('beforeend',
            `<div class="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-2 rounded mb-1">
              <span class="font-bold text-slate-700 dark:text-slate-300 text-xs">${esc(item.name)} <span class="text-[9px] text-slate-400 uppercase ml-1">${esc(item.type)}</span></span>
              <div class="flex gap-2">
                <span class="text-emerald-600 text-xs font-bold money-val">${sym()}${fmt(item.value)}</span>
                <button type="button" data-edit-asset="${item.id}" class="text-slate-300 hover:text-indigo-500"><i class="fas fa-pencil-alt"></i></button>
                <button type="button" data-del-wealth="assets:${item.id}" class="text-slate-300 hover:text-rose-500"><i class="fas fa-trash-alt"></i></button>
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
            `<div class="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-2 rounded mb-1">
              <span class="font-bold text-slate-700 dark:text-slate-300 text-xs">${esc(item.name)}</span>
              <div class="flex gap-2">
                <span class="text-rose-600 text-xs font-bold money-val">${sym()}${fmt(item.value)}</span>
                <button type="button" data-edit-debt="${item.id}" class="text-slate-300 hover:text-indigo-500"><i class="fas fa-pencil-alt"></i></button>
                <button type="button" data-del-wealth="debts:${item.id}" class="text-slate-300 hover:text-rose-500"><i class="fas fa-trash-alt"></i></button>
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
    const pct = g.target > 0 ? Math.min(Math.max((g.current / g.target) * 100, 0), 100) : 0;
    const color = pct >= 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-indigo-500' : 'bg-amber-500';
    let deadlineHtml = '';
    if (g.deadline) {
      const dlDate  = new Date(g.deadline + 'T00:00:00'); // force local TZ parse
      const daysLeft = Math.ceil((dlDate.getTime() - Date.now()) / 86_400_000);
      const dlColor  = pct >= 100 ? 'text-emerald-500' : daysLeft < 0 ? 'text-rose-500' : daysLeft <= 30 ? 'text-amber-500' : 'text-slate-400';
      const dlLabel  = pct >= 100 ? 'Goal reached!' : daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`;
      deadlineHtml = `<span class="text-[10px] font-medium ${dlColor} ml-1"><i class="far fa-calendar-alt mr-0.5"></i>${esc(dlLabel)}</span>`;
    }
    list.insertAdjacentHTML('beforeend',
      `<div class="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg mb-2">
        <div class="flex justify-between items-start mb-1">
          <div>
            <span class="font-bold text-slate-700 dark:text-slate-200 text-xs">${esc(g.name)}</span>
            ${g.notes ? `<span class="text-[10px] text-slate-400 ml-2">${esc(g.notes)}</span>` : ''}
            ${deadlineHtml}
          </div>
          <div class="flex gap-2 items-center">
            <span class="text-xs text-slate-500">${sym()}${fmt(g.current)} / ${sym()}${fmt(g.target)}</span>
            <button type="button" data-edit-goal="${g.id}" class="text-slate-400 hover:text-indigo-500"><i class="fas fa-pencil-alt" style="font-size:10px"></i></button>
            <button type="button" data-del-goal="${g.id}" class="text-slate-400 hover:text-rose-500"><i class="fas fa-times" style="font-size:10px"></i></button>
          </div>
        </div>
        <div class="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div class="h-full ${color} rounded-full transition-all" style="width:${pct}%"></div>
        </div>
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
    upcoming.sort((a, b) => a.daysUntil - b.daysUntil).forEach(b => {
      const label = b.daysUntil === 0 ? 'Today' : b.daysUntil === 1 ? 'Tomorrow' : `In ${b.daysUntil}d`;
      list.insertAdjacentHTML('beforeend',
        `<div class="flex items-center gap-2 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-3 py-1.5 rounded-lg text-xs font-bold">
          <i class="fas fa-clock"></i>${esc(b.name)} <span class="font-normal money-val">${sym()}${fmt(b.amount)}</span>
          <span class="text-[9px] uppercase bg-amber-200 dark:bg-amber-800 px-1.5 py-0.5 rounded-full">${esc(label)}</span>
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

  const plans = getDebtPayoffPlans();
  if (plans.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Add liabilities with an interest rate or minimum payment to see payoff projections.</p>';
    return;
  }

  container.innerHTML = plans.map(p => {
    const never  = p.monthsToPayoff <= 0;
    const yr     = Math.floor(p.monthsToPayoff / 12);
    const mo     = p.monthsToPayoff % 12;
    const timeStr = never ? '∞'
      : yr > 0 ? `${yr}y ${mo}m` : `${mo}m`;

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
}

// ─── Insights view ────────────────────────────────────────────────────────────
export function renderInsights(): void {
  try {
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
  } catch (e) {
    console.error('Insights render error:', e);
  }
}
