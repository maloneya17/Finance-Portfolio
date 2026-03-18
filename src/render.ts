import { db, save } from './db';
import { math, fmt, esc, getMonthKey } from './utils';
import { BUDGET_WARN_PCT, CALENDAR_MAX_CHIPS } from './constants';
import { updateDashboardCharts, updateYearlyChart, updateWealthCharts, calcFireStats } from './charts';
import { getMonthPicker } from './main';
import { getRollover, getCurrentCats, consolidateWealth } from './finance';

export { getRollover, getCurrentCats };

// ─── Main dashboard render ────────────────────────────────────────────────────
const now = new Date();

export function render(): void {
  try {
    const key = getMonthPicker().value;
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
    const catFilter = (document.getElementById('txCatFilter') as HTMLSelectElement | null)?.value ?? '';
    const filtered = data.filter(t => {
      const matchSearch = t.desc.toLowerCase().includes(searchTerm) || t.category.toLowerCase().includes(searchTerm);
      const matchCat = !catFilter || t.category === catFilter;
      return matchSearch && matchCat;
    });
    filtered.sort((a, b) => b.updatedAt - a.updatedAt);

    const list = document.getElementById('listTx');
    if (list) {
      list.innerHTML = '';
      filtered.forEach(t => {
        const val = math(t.amount);
        const colorClass = t.type === 'income'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400';
        const sign = t.type === 'income' ? '+' : '-';
        list.insertAdjacentHTML('beforeend', `
          <tr class="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition group">
            <td class="py-3 pl-2">
              <div class="font-bold text-slate-700 dark:text-slate-200">${esc(t.desc)}</div>
              <div class="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-500">${esc(t.category)}</div>
            </td>
            <td class="text-right font-bold ${colorClass} money-val">${sign}£${fmt(val)}</td>
            <td class="text-right pr-2">
              <button type="button" data-edit-tx="${t.id}" class="text-slate-300 hover:text-indigo-500 transition px-2"><i class="fas fa-pencil-alt"></i></button>
              <button type="button" data-del-tx="${t.id}" class="text-slate-300 hover:text-rose-500 transition px-2"><i class="fas fa-trash-alt"></i></button>
            </td>
          </tr>`);
      });
    }

    document.getElementById('emptyState')?.classList.toggle('hidden', filtered.length > 0);

    const rollover = getRollover(key);
    const kpiInc = document.getElementById('kpiInc');
    if (kpiInc) kpiInc.innerHTML = `£${fmt(inc + rollover)} <span class='text-[10px] text-slate-400 block font-medium uppercase mt-1'>Rollover: £${fmt(rollover)}</span>`;
    setText('kpiExp', `£${fmt(exp)}`);
    setText('kpiSalary', `£${fmt(db.annualIncome)}`);

    const year = key.split('-')[0];
    let ytd = 0;
    Object.keys(db.transactions).forEach(k => {
      if (k.startsWith(year))
        db.transactions[k].forEach(t => { if (t.type === 'income') ytd += math(t.amount); });
    });
    setText('kpiYTD', `£${fmt(ytd)}`);
    const monthNum = parseInt(key.split('-')[1] ?? '1');
    const safeMonth = monthNum >= 1 && monthNum <= 12 ? monthNum : 1;
    setText('kpiAvg', `£${fmt(ytd / safeMonth)}`);

    let maxCat = 'N/A', maxVal = 0;
    for (const [c, v] of Object.entries(cats)) { if (v > maxVal) { maxVal = v; maxCat = c; } }
    setText('kpiMaxCat', maxCat);
    setText('kpiMaxVal', `£${fmt(maxVal)}`);

    const savedAmt = inc - exp;
    const savingsRate = inc > 0 ? (savedAmt / inc) * 100 : 0;
    const isDeficit = savedAmt < 0;
    const rateEl = document.getElementById('kpiSavingsRate');
    if (rateEl) {
      rateEl.innerText = `${savingsRate.toFixed(1)}%`;
      rateEl.className = `text-2xl font-bold mt-1 ${isDeficit ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400'}`;
    }
    setText('kpiSavingsAmt', isDeficit ? `£${fmt(Math.abs(savedAmt))} deficit` : `£${fmt(savedAmt)} saved`);

    const todayKey = getMonthKey(now);
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
    setText('budgetMonthLabel', getMonthPicker().value);
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
                <span class="text-xs font-bold text-slate-500"><span class="money-val">£${fmt(spent)}</span> / <span class="money-val">£${fmt(budget)}</span></span>
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
      if (day > daysInMonth) { day = daysInMonth; b._shifted = true; } else { b._shifted = false; }
      if (!billMap[day]) billMap[day] = [];
      billMap[day].push(b);
      total += b.amount;
      const s = (db.billStatus[key] ?? {})[b.id];
      const isPaid = typeof s === 'object' ? s.paid : !!s;
      if (!isPaid) unpaidBillTotal += b.amount;
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
        billsHtml += `<div class="bill-chip ${cls}" data-toggle-bill="${b.id}"${shiftTitle}>${checkIcon}<span class="bill-name truncate font-bold">${esc(b.name)}${shiftMark}</span><div class="flex items-center ml-1"><span class="bill-amt money-val">£${b.amount}</span><span class="btn-delete-bill ml-1 text-slate-400 hover:text-rose-500" data-del-bill="${b.id}"><i class="fas fa-times-circle"></i></span></div></div>`;
      });
      if (overflow > 0) billsHtml += `<div class="text-[9px] text-slate-400 font-bold pl-1">+${overflow} more</div>`;

      grid.insertAdjacentHTML('beforeend',
        `<div class="calendar-day bg-white dark:bg-slate-900/50 border-b border-r border-slate-200 dark:border-slate-800"><div class="day-number text-slate-400 dark:text-slate-500">${d}</div><div class="flex flex-col gap-1">${billsHtml}</div></div>`);
    }

    setText('calendarMonthLabel', new Date(y, m - 1).toLocaleString('default', { month: 'long', year: 'numeric' }));
    setText('billTotal', `£${fmt(total)}`);
    const rollover = getRollover(key);
    const txs = db.transactions[key] ?? [];
    const mInc = txs.filter(t => t.type === 'income').reduce((a, t) => a + math(t.amount), 0);
    const mExp = txs.filter(t => t.type === 'expense').reduce((a, t) => a + math(t.amount), 0);
    setText('billSafe', `£${fmt((mInc + rollover) - mExp - unpaidBillTotal)}`);
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
    txs.forEach(t => { if (t.type === 'income') inc += t.amount; else exp += t.amount; });
    const operatingCash = (inc + rollover) - exp;

    const displayTotalAssets = totalAssets + operatingCash;
    const liquidAssets = db.wealth.assets
      .filter(a => ['Savings', 'Cash', 'Investment'].includes(a.type))
      .reduce((a, b) => a + b.value, 0) + operatingCash;

    setText('wealthNet', `£${fmt(displayTotalAssets - totalDebts)}`);
    setText('wealthTotalAssets', `£${fmt(displayTotalAssets)}`);
    setText('wealthTotalDebts', `£${fmt(totalDebts)}`);
    setText('wealthLiquid', `£${fmt(liquidAssets)}`);

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

    setText('wealthFireNumber', `£${fmt(fireTarget)}`);
    setText('wealthFirePct', `${progress.toFixed(1)}%`);
    const fireBar = document.getElementById('wealthFireBar') as HTMLElement | null;
    if (fireBar) fireBar.style.width = `${progress}%`;
    setText('wealthFireMsg', hasData
      ? `Based on avg spending of £${fmt(avgMonthlyExp)}/mo (6-month window)`
      : `Add expense data to calibrate target. (Default: £2k/mo)`);

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
                <span class="text-emerald-600 text-xs font-bold money-val">£${fmt(item.value)}</span>
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
                <span class="text-rose-600 text-xs font-bold money-val">£${fmt(item.value)}</span>
                <button type="button" data-edit-debt="${item.id}" class="text-slate-300 hover:text-indigo-500"><i class="fas fa-pencil-alt"></i></button>
                <button type="button" data-del-wealth="debts:${item.id}" class="text-slate-300 hover:text-rose-500"><i class="fas fa-trash-alt"></i></button>
              </div>
            </div>`);
        });
      }
    }
  } catch (e) {
    console.error('Wealth render error:', e);
  }
}

// ─── Reports ──────────────────────────────────────────────────────────────────
export function renderReports(): void {
  try {
    const years = new Set([new Date().getFullYear()]);
    Object.keys(db.transactions).forEach(k => years.add(parseInt(k.split('-')[0])));
    const sel = document.getElementById('reportYearSelect') as HTMLSelectElement | null;
    if (!sel) return;

    if (sel.options.length === 0) {
      Array.from(years).sort((a, b) => b - a).forEach(y => {
        sel.insertAdjacentHTML('beforeend', `<option value="${y}">${y}</option>`);
      });
      const dashYear = parseInt(getMonthPicker().value.split('-')[0]);
      if (years.has(dashYear)) sel.value = String(dashYear);
    }

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
            <td class="text-right text-emerald-600 dark:text-emerald-400 money-val">£${fmt(mInc)}</td>
            <td class="text-right text-rose-600 dark:text-rose-400 money-val">£${fmt(mExp)}</td>
            <td class="text-right pr-3 font-bold ${netColor} money-val">£${fmt(net)}</td>
          </tr>`);
      }
    }

    if (!hasData) monthTable.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-slate-400 text-xs">No data for ${targetYear}</td></tr>`;

    updateYearlyChart(chLabels, chInc, chExp);
  } catch (e) {
    console.error('Report render error:', e);
  }
}

// ─── Dropdowns ───────────────────────────────────────────────────────────────
export function renderDropdowns(): void {
  const sel = document.getElementById('txCat') as HTMLSelectElement | null;
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '';
    db.categories.forEach(c => sel.insertAdjacentHTML('beforeend', `<option value="${c}">${esc(c)}</option>`));
    sel.insertAdjacentHTML('beforeend', `<option value="ADD_NEW">+ New Category...</option>`);
    if (db.categories.includes(cur)) sel.value = cur;
  }

  const filter = document.getElementById('txCatFilter') as HTMLSelectElement | null;
  if (filter) {
    const cf = filter.value;
    filter.innerHTML = '<option value="">All Categories</option>';
    db.categories.forEach(c => filter.insertAdjacentHTML('beforeend', `<option value="${c}">${esc(c)}</option>`));
    if (db.categories.includes(cf)) filter.value = cf;
  }

  const recCat = document.getElementById('recCat') as HTMLSelectElement | null;
  if (recCat) {
    recCat.innerHTML = '';
    db.categories.forEach(c => recCat.insertAdjacentHTML('beforeend', `<option value="${c}">${esc(c)}</option>`));
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
          <span class="font-bold ${col}">${sign}£${fmt(r.amount)}</span>
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
          <i class="fas fa-clock"></i>${esc(b.name)} <span class="font-normal money-val">£${fmt(b.amount)}</span>
          <span class="text-[9px] uppercase bg-amber-200 dark:bg-amber-800 px-1.5 py-0.5 rounded-full">${esc(label)}</span>
        </div>`);
    });
  } else {
    widget.classList.add('hidden');
  }
}

