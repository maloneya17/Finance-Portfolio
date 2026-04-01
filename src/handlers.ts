import { db, save, persistOnly, clearAndReload, STORAGE_KEY } from './db';
import { math, fmt, genId, esc, setCurrencySymbol, symFmt, haptic } from './utils';
import { MAX_TX_AMOUNT, MAX_DESC_LENGTH } from './constants';
import { showToast } from './toast';
import { showTextInputModal, showConfirmModal } from './modal';
import {
  render,
  renderCalendar,
  renderWealth,
  renderDropdowns,
  renderSettingsCats,
  renderRecurring,
  renderRecurringSuggestions,
  renderAccounts,
  selectedTxIds,
} from './render';
import { getMonthPicker } from './main';
import { getRollover, consolidateWealth, getCategoryAvgAmount, getCurrentCats, detectRecurringCandidates, isValidMonthKey } from './finance';
import { parseOFX, parseQIF } from './bankimport';
import type { BankRow } from './bankimport';
import type { SplitEntry, InstalmentPlan } from './types';
import type { AssetType } from './types';
import { fetchAssetPrice, clearPriceCache } from './priceapi';

export { consolidateWealth };

// ─── Null-safe DOM helpers ────────────────────────────────────────────────────
const inp = (id: string) => document.getElementById(id) as HTMLInputElement | null;
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement | null;
const sel = (id: string) => document.getElementById(id) as HTMLSelectElement | null;

// ─── Tx type toggle ───────────────────────────────────────────────────────────
let currentTxType: 'income' | 'expense' = 'expense';

export function getTxType(): 'income' | 'expense' { return currentTxType; }

export function setTxType(type: 'income' | 'expense'): void {
  currentTxType = type;
  const btnExp = document.getElementById('btnExp');
  const btnInc = document.getElementById('btnInc');
  if (btnExp) {
    btnExp.className = `seg-btn text-rose-600${type === 'expense' ? ' active' : ''}`;
  }
  if (btnInc) {
    btnInc.className = `seg-btn text-emerald-600${type === 'income' ? ' active' : ''}`;
  }
}

// ─── Transaction form error helper ────────────────────────────────────────────
/** Shows a toast AND announces the error to the screen-reader live region. */
function txError(msg: string): void {
  showToast(msg);
  const el = document.getElementById('txFormError');
  if (el) { el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000); }
}

// ─── Transaction CRUD ─────────────────────────────────────────────────────────
let editingTxId: string | null = null;
/** Original month key when an edit was started — prevents saving to the wrong month
 *  if the user changes the month picker between clicking Edit and clicking Update. */
let editingTxMonth: string | null = null;

export function saveTransaction(): void {
  const k = getMonthPicker().value;
  const descEl    = document.getElementById('txDesc')    as HTMLInputElement | null;
  const amtEl     = document.getElementById('txAmt')     as HTMLInputElement | null;
  const catEl     = document.getElementById('txCat')     as HTMLSelectElement | null;
  const dateEl    = document.getElementById('txDate')    as HTMLInputElement | null;
  const notesEl   = document.getElementById('txNotes')   as HTMLInputElement | null;
  const tagsEl    = document.getElementById('txTags')    as HTMLInputElement | null;
  const accountEl = document.getElementById('txAccount') as HTMLSelectElement | null;

  const desc    = descEl?.value.trim().slice(0, MAX_DESC_LENGTH) ?? '';
  const amt     = math(amtEl?.value ?? '');
  const cat     = catEl?.value ?? '';
  const date    = dateEl?.value ?? '';
  const notes   = notesEl?.value.trim().slice(0, 200) ?? '';
  const account = accountEl?.value || undefined;
  // Parse comma-separated tags
  const tags  = (tagsEl?.value ?? '')
    .split(',')
    .map(t => t.trim().toLowerCase().slice(0, 30))
    .filter(t => t.length > 0)
    .slice(0, 10);

  // Parse split rows from DOM (if split panel is visible)
  const splits = parseSplitRows();
  const isSplit = splits.length > 0;

  if (!desc) return txError('Please enter a description');
  if (!amt || amt <= 0) return txError('Please enter a valid positive amount');
  if (amt > MAX_TX_AMOUNT) return txError(`Amount is unreasonably large (max ${db.currency}${MAX_TX_AMOUNT.toLocaleString()})`);

  if (isSplit) {
    // Validate: splits must sum to total (within 1 cent)
    const splitTotal = splits.reduce((s, r) => s + r.amount, 0);
    if (Math.abs(splitTotal - amt) > 0.01) {
      return txError(`Split amounts total ${db.currency}${fmt(splitTotal)} but transaction is ${db.currency}${fmt(amt)} — they must match.`);
    }
    if (splits.some(s => !s.category || s.category === 'ADD_NEW')) {
      return txError('Each split row must have a valid category.');
    }
  } else {
    if (cat === 'ADD_NEW') return txError('Please select a valid category');
  }

  // Effective category for unsplit transactions
  const effectiveCat = isSplit ? 'Split' : cat;

  // ─── Spending spike check (only for new single-category expenses, not edits) ──
  if (!editingTxId && currentTxType === 'expense' && !isSplit) {
    const avgAmt = getCategoryAvgAmount(cat, k);
    if (avgAmt !== null && amt > avgAmt * 3 && amt > 50) {
      // Non-blocking warning toast — the save proceeds
      showToast(`💡 Heads up: ${db.currency}${fmt(amt)} is unusually high for ${cat} (avg ${db.currency}${fmt(avgAmt)} per transaction)`);
    }
  }

  if (editingTxId) {
    const srcKey = editingTxMonth ?? k;
    const txIndex = (db.transactions[srcKey] ?? []).findIndex(t => t.id === editingTxId);
    if (txIndex > -1) {
      db.transactions[srcKey][txIndex] = {
        ...db.transactions[srcKey][txIndex],
        desc, amount: amt, category: effectiveCat, type: currentTxType,
        date: date || undefined, notes: notes || undefined,
        tags: tags.length ? tags : undefined,
        splits: isSplit ? splits : undefined,
        account: account ?? db.transactions[srcKey][txIndex].account,
        updatedAt: Date.now(),
      };
    } else {
      showToast('Transaction no longer exists — it may have been deleted in another tab.');
    }
    resetTxForm();
  } else {
    if (!db.transactions[k]) db.transactions[k] = [];
    db.transactions[k].push({
      id: genId(), updatedAt: Date.now(),
      desc, amount: amt, category: effectiveCat, type: currentTxType,
      date: date || undefined, notes: notes || undefined,
      tags: tags.length ? tags : undefined,
      splits: isSplit ? splits : undefined,
      account: account || undefined,
    });
    if (descEl) descEl.value = '';
    if (amtEl)  amtEl.value  = '';
    if (notesEl) notesEl.value = '';
    if (tagsEl)  tagsEl.value  = '';
    // Keep date/category for fast repeat entry; reset split state
    resetSplitPanel();
  }
  save();

  // ─── Haptic feedback ──────────────────────────────────────────────────────
  if (currentTxType === 'income') {
    haptic('income');
  } else {
    // Check if any budget category is now over-limit after this expense
    const cats = getCurrentCats(k);
    const overBudget = !isSplit && db.budgets[effectiveCat] > 0 && (cats[effectiveCat] ?? 0) > db.budgets[effectiveCat];
    haptic(overBudget ? 'warn' : 'confirm');
  }
  // Celebrate only when a goal *becomes* complete (not already-completed goals)
  const nowCompleteCount = db.goals.filter(g => g.current >= g.target).length;
  if (nowCompleteCount > _prevCompleteGoalCount) haptic('celebrate');
  _prevCompleteGoalCount = nowCompleteCount;
}

/** Tracks how many goals were complete at last save — used to detect newly-completed goals. */
let _prevCompleteGoalCount = 0;

export function editTx(id: string): void {
  const k = getMonthPicker().value;
  const tx = (db.transactions[k] ?? []).find(t => t.id === id);
  if (!tx) return;
  editingTxId = id;
  editingTxMonth = k;
  const txDescEl  = inp('txDesc');  if (txDescEl)  txDescEl.value  = tx.desc;
  const txAmtEl   = inp('txAmt');   if (txAmtEl)   txAmtEl.value   = String(tx.amount);
  const txCatEl   = sel('txCat');   if (txCatEl)   txCatEl.value   = tx.category;
  const txDateEl  = inp('txDate');  if (txDateEl)  txDateEl.value  = tx.date ?? '';
  const txNotesEl = inp('txNotes'); if (txNotesEl) txNotesEl.value = tx.notes ?? '';
  const txTagsEl  = inp('txTags');  if (txTagsEl)  txTagsEl.value  = (tx.tags ?? []).join(', ');
  setTxType(tx.type);
  setText('txFormTitle', 'Edit Transaction');
  const submitBtn = btn('btnSubmitTx'); if (submitBtn) submitBtn.innerHTML = 'Update Transaction';
  document.getElementById('btnCancelEdit')?.classList.remove('hidden');
}

export function resetTxForm(): void {
  editingTxId = null;
  editingTxMonth = null;
  const txDescEl  = inp('txDesc');  if (txDescEl)  txDescEl.value  = '';
  const txAmtEl   = inp('txAmt');   if (txAmtEl)   txAmtEl.value   = '';
  const txDateEl  = inp('txDate');  if (txDateEl)  txDateEl.value  = new Date().toISOString().slice(0, 10);
  const txNotesEl = inp('txNotes'); if (txNotesEl) txNotesEl.value = '';
  const txTagsEl  = inp('txTags');  if (txTagsEl)  txTagsEl.value  = '';
  const txCatEl   = sel('txCat');   if (txCatEl?.options.length) txCatEl.selectedIndex = 0;
  setText('txFormTitle', 'Add Transaction');
  const submitBtn = btn('btnSubmitTx'); if (submitBtn) submitBtn.innerHTML = 'Add Transaction';
  document.getElementById('btnCancelEdit')?.classList.add('hidden');
  setTxType('expense');
  resetSplitPanel();
}

// ─── Split-transaction panel ───────────────────────────────────────────────────

/** Reads all split rows from the DOM and returns validated SplitEntry array. */
function parseSplitRows(): SplitEntry[] {
  const panel = document.getElementById('splitPanel');
  if (!panel || panel.classList.contains('hidden')) return [];
  const rows = panel.querySelectorAll<HTMLElement>('[data-split-row]');
  const entries: SplitEntry[] = [];
  rows.forEach(row => {
    const catEl = row.querySelector<HTMLSelectElement>('[data-split-cat]');
    const amtEl = row.querySelector<HTMLInputElement>('[data-split-amt]');
    const cat = catEl?.value ?? '';
    const amt = math(amtEl?.value ?? '');
    if (cat && amt > 0) entries.push({ category: cat, amount: amt });
  });
  return entries;
}

/** Hides and clears the split panel, resets the toggle label. */
export function resetSplitPanel(): void {
  const panel = document.getElementById('splitPanel');
  const label = document.getElementById('splitToggleLabel');
  const rows  = document.getElementById('splitRows');
  if (panel) panel.classList.add('hidden');
  if (rows) rows.innerHTML = '';
  if (label) label.textContent = 'Add Split';
  updateSplitRemaining();
}

/** Adds a new split row to the split panel. */
export function addSplitRow(): void {
  const panel = document.getElementById('splitPanel');
  const rows  = document.getElementById('splitRows');
  if (!rows || !panel) return;
  panel.classList.remove('hidden');
  document.getElementById('splitToggleLabel')!.textContent = 'Remove Split';

  const rowDiv = document.createElement('div');
  rowDiv.setAttribute('data-split-row', '');
  rowDiv.className = 'flex items-center gap-2';

  // Category select — clone options from the main txCat select
  const catSel = document.createElement('select');
  catSel.setAttribute('data-split-cat', '');
  catSel.className = 'flex-1 p-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white outline-none focus:border-indigo-500 transition cursor-pointer';
  const mainCat = document.getElementById('txCat') as HTMLSelectElement | null;
  if (mainCat) {
    Array.from(mainCat.options)
      .filter(o => o.value && o.value !== 'ADD_NEW')
      .forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.text;
        catSel.appendChild(opt);
      });
  }
  catSel.addEventListener('change', updateSplitRemaining);

  const amtInput = document.createElement('input');
  amtInput.type = 'number';
  amtInput.step = '0.01';
  amtInput.min = '0';
  amtInput.placeholder = '0.00';
  amtInput.setAttribute('data-split-amt', '');
  amtInput.className = 'w-24 p-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white outline-none focus:border-indigo-500 transition';
  amtInput.addEventListener('input', updateSplitRemaining);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.innerHTML = '<i class="fas fa-times"></i>';
  removeBtn.className = 'text-slate-400 hover:text-rose-500 transition text-xs px-1';
  removeBtn.addEventListener('click', () => {
    rowDiv.remove();
    if (!document.querySelector('[data-split-row]')) resetSplitPanel();
    else updateSplitRemaining();
  });

  rowDiv.appendChild(catSel);
  rowDiv.appendChild(amtInput);
  rowDiv.appendChild(removeBtn);
  rows.appendChild(rowDiv);
  amtInput.focus();
  updateSplitRemaining();
}

/** Updates the "Remaining" label in the split panel. */
export function updateSplitRemaining(): void {
  const amtEl = document.getElementById('txAmt') as HTMLInputElement | null;
  const total = math(amtEl?.value ?? '');
  const splits = parseSplitRows();
  const allocated = splits.reduce((s, r) => s + r.amount, 0);
  const remaining = math(total - allocated);
  const label = document.getElementById('splitRemaining');
  if (!label) return;
  const sym_ = db.currency;
  if (total === 0) { label.textContent = 'Remaining: —'; label.className = 'font-bold text-slate-500 text-[10px]'; return; }
  label.textContent = `Remaining: ${sym_}${fmt(Math.abs(remaining))}${remaining < 0 ? ' over' : ''}`;
  label.className = `font-bold text-[10px] ${remaining < -0.01 ? 'text-rose-500' : remaining < 0.01 ? 'text-emerald-500' : 'text-amber-500'}`;
}

export function delTx(id: string): void {
  const k = getMonthPicker().value;
  const tx = (db.transactions[k] ?? []).find(t => t.id === id);
  if (!tx) return;
  const backup = { ...tx };
  db.deletedIds.push(id);
  db.transactions[k] = db.transactions[k].filter(t => t.id !== id);
  if (db.transactions[k].length === 0) delete db.transactions[k]; // keep storage tidy
  if (editingTxId === id) resetTxForm();
  save();
  showToast(`Deleted "${tx.desc.slice(0, 25)}"`, () => {
    db.deletedIds = db.deletedIds.filter(d => d !== id);
    if (!db.transactions[k]) db.transactions[k] = [];
    db.transactions[k].push(backup);
    save();
  });
}

// ─── Bulk transaction actions ─────────────────────────────────────────────────
export function bulkDeleteTx(): void {
  const k = getMonthPicker().value;
  const ids = Array.from(selectedTxIds);
  if (ids.length === 0) return;
  const backups = (db.transactions[k] ?? []).filter(t => ids.includes(t.id));
  db.deletedIds.push(...ids);
  db.transactions[k] = (db.transactions[k] ?? []).filter(t => !ids.includes(t.id));
  if (db.transactions[k]?.length === 0) delete db.transactions[k]; // keep storage tidy
  selectedTxIds.clear();
  save();
  showToast(`Deleted ${ids.length} transaction${ids.length > 1 ? 's' : ''}`, () => {
    db.deletedIds = db.deletedIds.filter(d => !ids.includes(d));
    if (!db.transactions[k]) db.transactions[k] = [];
    db.transactions[k].push(...backups);
    save();
  });
}

export function bulkRecategorizeTx(newCat: string): void {
  const k = getMonthPicker().value;
  const ids = Array.from(selectedTxIds);
  if (ids.length === 0 || !newCat) { showToast('Pick a category first'); return; }
  db.transactions[k] = (db.transactions[k] ?? []).map(t =>
    ids.includes(t.id) ? { ...t, category: newCat, updatedAt: Date.now() } : t
  );
  selectedTxIds.clear();
  save();
  showToast(`Updated ${ids.length} transaction${ids.length > 1 ? 's' : ''} to "${newCat}"`);
}

// ─── Category check ───────────────────────────────────────────────────────────
/** 'ADD_NEW' is a sentinel value in the category select — reject it as an actual name. */
const RESERVED_CAT_NAMES = new Set(['ADD_NEW']);

function validateCatName(n: string): string | null {
  if (!n) return null;
  if (RESERVED_CAT_NAMES.has(n)) { showToast(`"${n}" is a reserved name — choose a different one.`); return null; }
  return n;
}

export async function checkNewCategory(sel: HTMLSelectElement): Promise<void> {
  if (sel.value !== 'ADD_NEW') return;
  // Reset to a valid option while the modal is open so no ADD_NEW sentinel remains
  sel.value = db.categories[0] ?? '';
  const raw = await showTextInputModal({ title: 'New Category', placeholder: 'e.g. Groceries', confirmLabel: 'Add' });
  const n = validateCatName(raw?.trim().slice(0, 50) ?? '');
  if (n && !db.categories.includes(n)) {
    db.categories.push(n);
    save();
    renderDropdowns();
    sel.value = n;
  } else if (n) {
    sel.value = n; // category already exists — select it
  }
}

export async function delCat(c: string): Promise<void> {
  const ok = await showConfirmModal({
    title: `Delete "${c}"?`,
    message: 'Existing transactions keep their category label but the category will no longer appear in filters or budgets.',
    confirmLabel: 'Delete',
    dangerous: true,
  });
  if (!ok) return;
  db.categories = db.categories.filter(x => x !== c);
  delete db.budgets[c];
  save();
  renderSettingsCats();
  renderDropdowns();
}

export async function addCatPrompt(): Promise<void> {
  const raw = await showTextInputModal({ title: 'Add Category', placeholder: 'Category Name', confirmLabel: 'Add' });
  const n = validateCatName(raw?.trim().slice(0, 50) ?? '');
  if (!n) return;
  if (!db.categories.includes(n)) {
    db.categories.push(n);
    save();
    renderSettingsCats();
    renderDropdowns();
  } else {
    showToast(`Category "${n}" already exists`);
  }
}

// ─── Bills ────────────────────────────────────────────────────────────────────
let editingBillId: string | null = null;

export function saveBill(): void {
  const name     = (inp('billName')?.value ?? '').trim().slice(0, 100);
  const amt      = math(inp('billAmt')?.value ?? '');
  const day      = parseInt(inp('billDay')?.value ?? '');
  const category = sel('billCat')?.value ?? 'Bills';

  if (!name) return showToast('Please enter a bill name');
  if (!amt || amt <= 0) return showToast('Please enter a valid positive amount');
  if (amt > MAX_TX_AMOUNT) return showToast(`Amount is unreasonably large (max ${db.currency}${MAX_TX_AMOUNT.toLocaleString()})`);
  if (!day || day < 1 || day > 31) return showToast('Day must be between 1 and 31');

  if (editingBillId) {
    const idx = db.bills.findIndex(b => b.id === editingBillId);
    if (idx > -1) db.bills[idx] = { ...db.bills[idx], name, amount: amt, day, category, updatedAt: Date.now() };
    cancelBillEdit();
  } else {
    db.bills.push({ id: genId(), updatedAt: Date.now(), name, amount: amt, day, category });
    if (inp('billName')) inp('billName')!.value = '';
    if (inp('billAmt'))  inp('billAmt')!.value  = '';
    if (inp('billDay'))  inp('billDay')!.value  = '';
  }
  save();
  renderCalendar();
}

export function editBill(id: string): void {
  const bill = db.bills.find(b => b.id === id);
  if (!bill) return;
  editingBillId = id;
  if (inp('billName')) inp('billName')!.value = bill.name;
  if (inp('billAmt'))  inp('billAmt')!.value  = String(bill.amount);
  if (inp('billDay'))  inp('billDay')!.value  = String(bill.day);
  if (sel('billCat'))  sel('billCat')!.value  = bill.category ?? 'Bills';
  const saveBtn = btn('btnSaveBill'); if (saveBtn) saveBtn.innerText = 'Update Bill';
  document.getElementById('btnCancelBill')?.classList.remove('hidden');
  document.getElementById('formBill')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function cancelBillEdit(): void {
  editingBillId = null;
  if (inp('billName')) inp('billName')!.value = '';
  if (inp('billAmt'))  inp('billAmt')!.value  = '';
  if (inp('billDay'))  inp('billDay')!.value  = '';
  const saveBtn = btn('btnSaveBill'); if (saveBtn) saveBtn.innerText = 'Add Bill';
  document.getElementById('btnCancelBill')?.classList.add('hidden');
}

export function toggleBill(id: string): void {
  const key = getMonthPicker().value;
  if (!db.billStatus[key]) db.billStatus[key] = {};
  const bill = db.bills.find(b => b.id === id);
  if (!bill) return;
  const s = db.billStatus[key][id];
  const isPaid = typeof s === 'object' ? s.paid : !!s;
  const billCat = bill.category ?? 'Bills';

  if (!isPaid) {
    // Use the bill's scheduled day (clamped to the last day of the current month)
    const [billYear, billMonth] = key.split('-').map(Number);
    const daysInMonth = new Date(billYear, billMonth, 0).getDate();
    const billDay = Math.min(bill.day, daysInMonth);
    const billDateStr = `${key}-${String(billDay).padStart(2, '0')}`;

    const txId = genId();
    db.billStatus[key][id] = { paid: true, updated: Date.now(), txId };
    if (!db.transactions[key]) db.transactions[key] = [];
    db.transactions[key].push({
      id: txId, updatedAt: Date.now(),
      date: billDateStr,
      desc: bill.name, amount: math(bill.amount), category: billCat, type: 'expense',
    });
    save();
    showToast(`"${bill.name}" marked paid — added to expenses`, () => {
      db.billStatus[key][id] = { paid: false, updated: Date.now() };
      db.transactions[key] = (db.transactions[key] ?? []).filter(t => t.id !== txId);
      if (db.transactions[key]?.length === 0) delete db.transactions[key]; // keep storage tidy
      save();
    });
  } else {
    // Remove the auto-created expense transaction if it exists
    const prevStatus = db.billStatus[key][id];
    if (typeof prevStatus === 'object' && prevStatus.txId) {
      db.transactions[key] = (db.transactions[key] ?? []).filter(t => t.id !== prevStatus.txId);
      if (db.transactions[key]?.length === 0) delete db.transactions[key]; // keep storage tidy
    }
    db.billStatus[key][id] = { paid: false, updated: Date.now() };
    save();
    showToast(`"${bill.name}" marked unpaid`);
  }
  renderCalendar();
  render();
}

export function delBill(id: string): void {
  const bill = db.bills.find(b => b.id === id);
  if (!bill) return;
  if (editingBillId === id) cancelBillEdit();
  const backup = { ...bill };

  // Capture associated status entries and linked expense transactions for full undo
  const statusBackup: Record<string, typeof db.billStatus[string][string]> = {};
  const txBackup: Record<string, typeof db.transactions[string]> = {};
  Object.keys(db.billStatus).forEach(monthKey => {
    const entry = db.billStatus[monthKey]?.[id];
    if (!entry) return;
    statusBackup[monthKey] = entry;
    if (typeof entry === 'object' && entry.txId) {
      const tx = (db.transactions[monthKey] ?? []).find(t => t.id === entry.txId);
      if (tx) { if (!txBackup[monthKey]) txBackup[monthKey] = []; txBackup[monthKey].push(tx); }
    }
  });

  db.deletedIds.push(id);
  db.bills = db.bills.filter(b => b.id !== id);
  // Clean up orphaned expense transactions created by bill-paid toggles
  Object.keys(db.billStatus).forEach(monthKey => {
    const entry = db.billStatus[monthKey]?.[id];
    if (typeof entry === 'object' && entry.txId) {
      db.transactions[monthKey] = (db.transactions[monthKey] ?? []).filter(t => t.id !== entry.txId);
    }
    if (db.billStatus[monthKey]) delete db.billStatus[monthKey][id];
  });
  save();
  renderCalendar();
  showToast(`Deleted bill "${backup.name}"`, () => {
    db.deletedIds = db.deletedIds.filter(d => d !== id);
    db.bills.push(backup);
    // Restore status entries and linked transactions
    Object.keys(statusBackup).forEach(monthKey => {
      if (!db.billStatus[monthKey]) db.billStatus[monthKey] = {};
      db.billStatus[monthKey][id] = statusBackup[monthKey];
    });
    Object.keys(txBackup).forEach(monthKey => {
      if (!db.transactions[monthKey]) db.transactions[monthKey] = [];
      db.transactions[monthKey].push(...txBackup[monthKey]);
    });
    save();
    renderCalendar();
  });
}

// ─── Assets & Debts ───────────────────────────────────────────────────────────
let editingAssetId: string | null = null;
let editingDebtId: string | null = null;

export function saveAsset(): void {
  const name   = (inp('assetName')?.value ?? '').trim().slice(0, 100);
  const val    = math(inp('assetVal')?.value ?? '');
  const type   = (sel('assetType')?.value ?? 'Other') as AssetType;
  const ticker = (inp('assetTicker')?.value ?? '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '').slice(0, 12) || undefined;
  const qty    = parseFloat(inp('assetQty')?.value ?? '');
  const quantity = isFinite(qty) && qty > 0 ? qty : undefined;

  if (!name) return showToast('Please enter an asset name');
  if (isNaN(val) || val < 0) return showToast('Please enter a valid non-negative value');
  if (val > MAX_TX_AMOUNT * 10) return showToast('Value exceeds maximum allowed');

  // Match on name AND type — consistent with consolidateWealth()'s deduplication key.
  // Two assets with the same name but different types are distinct (e.g. "Savings"/Savings
  // vs "Savings"/Investment) and must not be silently merged.
  const existing = db.wealth.assets.find(
    a => a.name.trim().toLowerCase() === name.trim().toLowerCase()
      && (a.type ?? 'Other').toLowerCase() === type.toLowerCase(),
  );

  if (editingAssetId) {
    const idx = db.wealth.assets.findIndex(a => a.id === editingAssetId);
    if (idx > -1) {
      // Guard: renaming to match another asset of the SAME type would silently merge
      // via consolidateWealth(). Different-type assets with the same name are allowed.
      const collision = db.wealth.assets.find(
        a => a.id !== editingAssetId
          && a.name.trim().toLowerCase() === name.toLowerCase()
          && (a.type ?? 'Other').toLowerCase() === type.toLowerCase(),
      );
      if (collision) { showToast(`An asset named "${collision.name}" (${type}) already exists — use a unique name.`); return; }
      db.wealth.assets[idx] = { ...db.wealth.assets[idx], name, value: val, type, ticker, quantity, updatedAt: Date.now() };
    }
    cancelWealthEdit();
  } else {
    if (existing) {
      existing.value += val;
      existing.updatedAt = Date.now();
      showToast(`${db.currency}${fmt(val)} added to "${existing.name}"`);
    } else {
      db.wealth.assets.push({ id: genId(), name, value: val, type, ticker, quantity, updatedAt: Date.now() });
    }
    const anEl = inp('assetName'); if (anEl) anEl.value = '';
    const avEl = inp('assetVal');  if (avEl) avEl.value = '';
    const atEl2 = inp('assetTicker'); if (atEl2) atEl2.value = '';
    const aqEl  = inp('assetQty');    if (aqEl)  aqEl.value  = '';
  }
  consolidateWealth();
  save();
  renderWealth();
}

export function editAsset(id: string): void {
  const asset = db.wealth.assets.find(a => a.id === id);
  if (!asset) return;
  cancelWealthEdit(); // clear any in-progress debt edit before starting asset edit
  editingAssetId = id;
  const anEl   = inp('assetName');   if (anEl)   anEl.value   = asset.name;
  const avEl   = inp('assetVal');    if (avEl)   avEl.value   = String(asset.value);
  const atEl   = sel('assetType');   if (atEl)   atEl.value   = asset.type ?? 'Other';
  const aticEl = inp('assetTicker'); if (aticEl) aticEl.value = asset.ticker ?? '';
  const aqEl   = inp('assetQty');    if (aqEl)   aqEl.value   = String(asset.quantity ?? '');
  const saveBtnA = btn('btnSaveAsset'); if (saveBtnA) saveBtnA.innerHTML = '<i class="fas fa-save"></i>';
  document.getElementById('btnCancelAsset')?.classList.remove('hidden');
}

export function saveDebt(): void {
  const name       = (inp('debtName')?.value ?? '').trim().slice(0, 100);
  const val        = math(inp('debtVal')?.value ?? '');
  const rateRaw    = inp('debtRate')?.value ?? '';
  const minPayRaw  = inp('debtMinPay')?.value ?? '';
  const interestRate = rateRaw   ? math(rateRaw)   : undefined;
  const minPayment   = minPayRaw ? math(minPayRaw) : undefined;

  if (!name) return showToast('Please enter a liability name');
  if (isNaN(val) || val < 0) return showToast('Please enter a valid non-negative value');
  if (val > MAX_TX_AMOUNT * 10) return showToast('Value exceeds maximum allowed');

  const existing = db.wealth.debts.find(d => d.name.trim().toLowerCase() === name.trim().toLowerCase());

  if (editingDebtId) {
    const idx = db.wealth.debts.findIndex(d => d.id === editingDebtId);
    if (idx > -1) {
      const collision = db.wealth.debts.find(
        d => d.id !== editingDebtId && d.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (collision) { showToast(`A liability named "${collision.name}" already exists — use a unique name.`); return; }
      db.wealth.debts[idx] = {
        ...db.wealth.debts[idx], name, value: val,
        interestRate: rateRaw   ? interestRate   : undefined,
        minPayment:   minPayRaw ? minPayment     : undefined,
        updatedAt: Date.now(),
      };
    }
    cancelWealthEdit();
  } else {
    if (existing) {
      existing.value += val;
      existing.updatedAt = Date.now();
      showToast(`${db.currency}${fmt(val)} added to "${existing.name}"`);
    } else {
      db.wealth.debts.push({ id: genId(), name, value: val, interestRate, minPayment, updatedAt: Date.now() });
    }
    const dnEl2 = inp('debtName');   if (dnEl2) dnEl2.value = '';
    const dvEl2 = inp('debtVal');    if (dvEl2) dvEl2.value = '';
    const drEl  = inp('debtRate');   if (drEl)  drEl.value  = '';
    const dmEl  = inp('debtMinPay'); if (dmEl)  dmEl.value  = '';
  }
  consolidateWealth();
  save();
  renderWealth();
}

export function editDebt(id: string): void {
  const debt = db.wealth.debts.find(d => d.id === id);
  if (!debt) return;
  cancelWealthEdit(); // clear any in-progress asset edit before starting debt edit
  editingDebtId = id;
  const dnEl = inp('debtName');   if (dnEl) dnEl.value = debt.name;
  const dvEl = inp('debtVal');    if (dvEl) dvEl.value = String(debt.value);
  const drEl = inp('debtRate');   if (drEl) drEl.value = String(debt.interestRate ?? '');
  const dmEl = inp('debtMinPay'); if (dmEl) dmEl.value = String(debt.minPayment ?? '');
  const saveBtnD = btn('btnSaveDebt'); if (saveBtnD) saveBtnD.innerHTML = '<i class="fas fa-save"></i>';
  document.getElementById('btnCancelDebt')?.classList.remove('hidden');
}

export function cancelWealthEdit(): void {
  editingAssetId = null;
  editingDebtId = null;
  const anEl = inp('assetName');   if (anEl) anEl.value = '';
  const avEl = inp('assetVal');    if (avEl) avEl.value = '';
  const dnEl = inp('debtName');    if (dnEl) dnEl.value = '';
  const dvEl = inp('debtVal');     if (dvEl) dvEl.value = '';
  const drEl = inp('debtRate');    if (drEl) drEl.value = '';
  const dmEl = inp('debtMinPay');  if (dmEl) dmEl.value = '';
  const saveBtnA = btn('btnSaveAsset'); if (saveBtnA) saveBtnA.innerHTML = '+';
  const saveBtnD = btn('btnSaveDebt');  if (saveBtnD) saveBtnD.innerHTML = '+';
  document.getElementById('btnCancelAsset')?.classList.add('hidden');
  document.getElementById('btnCancelDebt')?.classList.add('hidden');
}

export function delWealthItem(type: 'assets' | 'debts', id: string): void {
  const item = db.wealth[type].find(i => i.id === id);
  if (!item) return;
  const backup = { ...item };
  db.deletedIds.push(id);
  (db.wealth[type] as typeof db.wealth.assets) = db.wealth[type].filter(i => i.id !== id) as typeof db.wealth.assets;
  save();
  renderWealth();
  showToast(`Removed "${backup.name}"`, () => {
    db.deletedIds = db.deletedIds.filter(d => d !== id);
    (db.wealth[type] as typeof db.wealth.assets).push(backup as typeof db.wealth.assets[0]);
    save();
    renderWealth();
  });
}

// ─── Net Worth snapshot ───────────────────────────────────────────────────────
export function logNetWorth(): void {
  const key = getMonthPicker().value;
  const assets = db.wealth.assets.reduce((a, b) => a + math(b.value), 0);
  const debts  = db.wealth.debts.reduce((a, b) => a + math(b.value), 0);
  const rollover = getRollover(key);
  const txs = db.transactions[key] ?? [];
  let inc = 0, exp = 0;
  txs.forEach(t => { if (t.type === 'income') inc += math(t.amount); else exp += math(t.amount); });
  const net = (assets + (inc + rollover) - exp) - debts;
  if (!db.wealth.history) db.wealth.history = {};
  db.wealth.history[key] = net;
  save();
  renderWealth();
  showToast(`Logged Net Worth of ${symFmt(net)} for ${key}`);
}

// ─── Savings Goals ────────────────────────────────────────────────────────────
let editingGoalId: string | null = null;

export function saveGoal(): void {
  const name     = (inp('goalName')?.value ?? '').trim().slice(0, MAX_DESC_LENGTH);
  const target   = math(inp('goalTarget')?.value ?? '');
  const current  = math(inp('goalCurrent')?.value ?? '');
  const notes    = (inp('goalNotes')?.value ?? '').trim().slice(0, 200);
  const deadline = (inp('goalDeadline')?.value ?? '').trim() || undefined;

  if (!name) return showToast('Please enter a goal name');
  if (!target || target <= 0) return showToast('Please enter a valid target amount');
  if (current < 0) return showToast('Current saved amount cannot be negative');

  if (editingGoalId) {
    const idx = db.goals.findIndex(g => g.id === editingGoalId);
    if (idx > -1) db.goals[idx] = { ...db.goals[idx], name, target, current, notes: notes || undefined, deadline };
    cancelGoalEdit();
  } else {
    db.goals.push({ id: genId(), name, target, current, notes: notes || undefined, deadline });
    if (inp('goalName'))     inp('goalName')!.value     = '';
    if (inp('goalTarget'))   inp('goalTarget')!.value   = '';
    if (inp('goalCurrent'))  inp('goalCurrent')!.value  = '';
    if (inp('goalNotes'))    inp('goalNotes')!.value    = '';
    if (inp('goalDeadline')) inp('goalDeadline')!.value = '';
  }
  save();
  renderWealth();
}

export function editGoal(id: string): void {
  const goal = db.goals.find(g => g.id === id);
  if (!goal) return;
  editingGoalId = id;
  if (inp('goalName'))     inp('goalName')!.value     = goal.name;
  if (inp('goalTarget'))   inp('goalTarget')!.value   = String(goal.target);
  if (inp('goalCurrent'))  inp('goalCurrent')!.value  = String(goal.current);
  if (inp('goalNotes'))    inp('goalNotes')!.value     = goal.notes ?? '';
  if (inp('goalDeadline')) inp('goalDeadline')!.value  = goal.deadline ?? '';
  const sbtn = btn('btnSaveGoal'); if (sbtn) sbtn.innerText = 'Update Goal';
  document.getElementById('btnCancelGoal')?.classList.remove('hidden');
  document.getElementById('goalSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function cancelGoalEdit(): void {
  editingGoalId = null;
  if (inp('goalName'))     inp('goalName')!.value     = '';
  if (inp('goalTarget'))   inp('goalTarget')!.value   = '';
  if (inp('goalCurrent'))  inp('goalCurrent')!.value  = '';
  if (inp('goalNotes'))    inp('goalNotes')!.value     = '';
  if (inp('goalDeadline')) inp('goalDeadline')!.value  = '';
  const sbtn = btn('btnSaveGoal'); if (sbtn) sbtn.innerText = '+ Add Goal';
  document.getElementById('btnCancelGoal')?.classList.add('hidden');
}

export function delGoal(id: string): void {
  const goal = db.goals.find(g => g.id === id);
  if (!goal) return;
  if (editingGoalId === id) cancelGoalEdit();
  const backup = { ...goal };
  db.goals = db.goals.filter(g => g.id !== id);
  save();
  renderWealth();
  showToast(`Removed goal "${backup.name}"`, () => {
    db.goals.push(backup);
    save();
    renderWealth();
  });
}

// ─── Goal quick-contribute ────────────────────────────────────────────────────
export function contributeGoal(id: string, amount: number): void {
  const idx = db.goals.findIndex(g => g.id === id);
  if (idx < 0 || amount <= 0) return;
  const prev = db.goals[idx].current;
  db.goals[idx].current = math(prev + amount);
  const goal = db.goals[idx];
  save();
  if (goal.current >= goal.target && prev < goal.target) haptic('celebrate');
  renderWealth();
  showToast(`+${symFmt(amount)} added to "${goal.name}"`);
}

// ─── Currency ─────────────────────────────────────────────────────────────────
export function saveCurrency(): void {
  const raw = (inp('currencySymbolInput')?.value ?? '').trim().slice(0, 5);
  // Allowlist: only Unicode currency/letter/digit characters — no HTML, no scripts.
  // \p{Sc} = currency symbols (£ $ € ¥ …), \p{L} = letters, \p{N} = digits.
  if (!raw || !/^[\p{Sc}\p{L}\p{N}]{1,5}$/u.test(raw)) {
    return showToast('Invalid currency symbol (letters, digits, and currency signs only)');
  }
  db.currency = raw;
  setCurrencySymbol(raw);
  save();
  showToast(`Currency set to "${raw}"`);
}

// ─── Recurring templates ──────────────────────────────────────────────────────
let currentRecType: 'income' | 'expense' = 'expense';

export function setRecType(type: 'income' | 'expense'): void {
  currentRecType = type;
  const isExp = type === 'expense';
  const btnExp = document.getElementById('recBtnExp');
  const btnInc = document.getElementById('recBtnInc');
  if (btnExp) btnExp.className = `seg-btn text-rose-600${isExp ? ' active' : ''}`;
  if (btnInc) btnInc.className = `seg-btn text-emerald-600${!isExp ? ' active' : ''}`;
}

export function saveRecurring(): void {
  const desc = (inp('recDesc')?.value ?? '').trim().slice(0, MAX_DESC_LENGTH);
  const amt  = math(inp('recAmt')?.value ?? '');
  const cat  = sel('recCat')?.value ?? '';
  if (!desc) return showToast('Enter a description');
  if (!amt || amt <= 0) return showToast('Enter a valid positive amount');
  if (amt > MAX_TX_AMOUNT) return showToast(`Amount is unreasonably large (max ${db.currency}${MAX_TX_AMOUNT.toLocaleString()})`);
  if (!cat) return showToast('Please select a category');
  db.recurring.push({ id: genId(), desc, amount: amt, category: cat, type: currentRecType });
  const rdEl = inp('recDesc'); if (rdEl) rdEl.value = '';
  const raEl = inp('recAmt');  if (raEl) raEl.value = '';
  save();
  renderRecurring();
}

export function delRecurring(id: string): void {
  const template = db.recurring.find(r => r.id === id);
  if (!template) return;
  const backup = { ...template };
  db.recurring = db.recurring.filter(r => r.id !== id);
  save();
  renderRecurring();
  showToast(`Removed "${backup.desc}"`, () => {
    db.recurring.push(backup);
    save();
    renderRecurring();
  });
}

/** Apply recurring templates to the current month. Returns number of transactions added. */
export function applyRecurring(silent = false): number {
  if (!db.recurring || db.recurring.length === 0) {
    if (!silent) showToast('No templates set up — add them in Settings');
    return 0;
  }
  const key = getMonthPicker().value;
  if (!db.transactions[key]) db.transactions[key] = [];
  let count = 0;
  // Use today's date only when applying to the current month; otherwise use the
  // first day of the target month so recurring entries aren't dated in the future/past.
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const defaultDate = key === currentMonthKey
    ? today.toISOString().slice(0, 10)
    : `${key}-01`;
  db.recurring.forEach(r => {
    const exists = db.transactions[key].some(t => t.desc === r.desc && t.amount === r.amount && t.type === r.type && t.category === r.category);
    if (!exists) {
      db.transactions[key].push({
        id: genId(), updatedAt: Date.now(),
        date: defaultDate,
        desc: r.desc, amount: r.amount, category: r.category, type: r.type,
      });
      count++;
    }
  });
  // Always mark this month as processed to prevent boot re-running every page load
  // when all templates are already present (count = 0 is a valid "already done" state).
  db.lastAutoAppliedMonth = key;
  if (count > 0) {
    save();
    if (!silent) showToast(`Applied ${count} recurring transaction${count > 1 ? 's' : ''}`);
  } else {
    if (!silent) showToast('All recurring transactions already applied this month');
    else persistOnly(); // persist the marker update without triggering a full re-render
  }
  return count;
}

// ─── Annual income ────────────────────────────────────────────────────────────
export async function editAnnualIncome(): Promise<void> {
  const raw = await showTextInputModal({
    title: 'Annual Salary',
    label: 'Enter your gross annual salary',
    defaultValue: String(db.annualIncome || ''),
    inputType: 'number',
    placeholder: '0',
    confirmLabel: 'Save',
  });
  if (raw === null) return;
  const parsed = math(raw);
  if (isNaN(parsed) || parsed < 0) return showToast('Please enter a valid non-negative salary');
  if (parsed > MAX_TX_AMOUNT * 10) return showToast('Value exceeds maximum allowed');
  db.annualIncome = parsed;
  db.annualIncomeUpdatedAt = Date.now();
  save();
}

// ─── CSV Import ───────────────────────────────────────────────────────────────
let csvData: string[][] = [];

const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * RFC 4180-compliant CSV row splitter.
 * Handles quoted fields containing commas, escaped quotes (""), and plain fields.
 */
function splitCsvRow(row: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (inQuotes) {
      if (c === '"') {
        if (row[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;                          // closing quote
      } else {
        field += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { fields.push(field.trim()); field = ''; }
      else { field += c; }
    }
  }
  fields.push(field.trim());
  return fields;
}

export function handleCsvFile(file: File): void {
  // Extension check only — MIME type is not reliable (varies by OS/browser)
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Please upload a .csv file'); return;
  }
  if (file.size > MAX_CSV_BYTES) {
    showToast('File too large — maximum 5 MB'); return;
  }
  const reader = new FileReader();
  reader.onload = (evt) => {
    const text = evt.target?.result as string;
    // Split on \r\n or \n (handles Windows/Unix), then proper CSV-field split per row
    const rows = text.split(/\r?\n/).map(splitCsvRow);
    // Drop empty trailing rows (common when file ends with a newline)
    while (rows.length > 0 && rows[rows.length - 1].every(c => !c)) rows.pop();
    if (rows.length < 2) { showToast('Invalid CSV — needs at least a header row and one data row'); return; }

    csvData = rows;
    const headers = rows[0];
    const selects = ['mapDate', 'mapDesc', 'mapAmt'];
    selects.forEach(id => {
      const sel = document.getElementById(id) as HTMLSelectElement | null;
      if (!sel) return;
      sel.innerHTML = '';
      headers.forEach((h, i) => sel.insertAdjacentHTML('beforeend', `<option value="${i}">${esc(h.trim())}</option>`));
    });
    // Auto-select the most likely column for each field based on header names.
    // Use .value = (not setAttribute) so the <select> element reflects the change immediately.
    headers.forEach((h, i) => {
      const lower = h.trim().toLowerCase();
      const mapDate = document.getElementById('mapDate') as HTMLSelectElement | null;
      const mapDesc = document.getElementById('mapDesc') as HTMLSelectElement | null;
      const mapAmt  = document.getElementById('mapAmt')  as HTMLSelectElement | null;
      if (lower.includes('date'))                          { if (mapDate) mapDate.value = String(i); }
      if (lower.includes('desc') || lower.includes('detail') || lower.includes('narr') || lower.includes('ref')) { if (mapDesc) mapDesc.value = String(i); }
      if (lower.includes('amount') || lower.includes('value') || lower.includes('debit') || lower.includes('credit')) { if (mapAmt) mapAmt.value = String(i); }
    });
    document.getElementById('csvMapper')?.classList.remove('hidden');
    setText('csvPreview', `Loaded ${rows.length - 1} rows. Select columns above.`);
  };
  reader.onerror = () => showToast('Could not read file — it may be corrupted or locked.');
  reader.readAsText(file, 'utf-8');
}

/** Abbreviated and full English month names → 2-digit month string */
const MONTH_NAME_MAP: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  january:'01', february:'02', march:'03', april:'04', june:'06',
  july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
};

export function executeImport(): void {
  try {
    const dateSelect = document.getElementById('mapDate') as HTMLSelectElement | null;
    const descSelect = document.getElementById('mapDesc') as HTMLSelectElement | null;
    const amtSelect  = document.getElementById('mapAmt')  as HTMLSelectElement | null;
    const invertEl   = document.getElementById('mapInvert') as HTMLInputElement | null;
    if (!dateSelect || !descSelect || !amtSelect || !invertEl) {
      showToast('Import UI not ready — please reload the page and try again.'); return;
    }
    const dateIdx = parseInt(dateSelect.value);
    const descIdx = parseInt(descSelect.value);
    const amtIdx  = parseInt(amtSelect.value);
    const invert  = invertEl.checked;
    let count = 0, skipped = 0;
    const skippedRows: string[] = [];

    // Build a set of content-hash keys for all existing transactions so we can
    // skip exact duplicates on re-import (date|desc|amount|type fingerprint).
    const existingKeys = new Set<string>();
    Object.values(db.transactions).forEach(txs =>
      txs.forEach(t => existingKeys.add(`${t.date ?? ''}|${t.desc}|${t.amount}|${t.type}`)),
    );

    for (let i = 1; i < csvData.length; i++) {
      const row = csvData[i];
      if (row.length === 0 || (row.length === 1 && !row[0]?.trim())) continue;

      // Strip non-numeric chars (currency symbols, spaces, thousands separators)
      // then handle trailing minus sign used by some bank exports (e.g. "1234.56-")
      let rawAmtStr = row[amtIdx]?.replace(/[^0-9.-]/g, '') ?? '';
      if (rawAmtStr.endsWith('-')) rawAmtStr = '-' + rawAmtStr.slice(0, -1);
      let rawAmt = parseFloat(rawAmtStr);
      if (isNaN(rawAmt) || !isFinite(rawAmt)) { skipped++; skippedRows.push(`Row ${i + 1}: invalid amount "${row[amtIdx] ?? ''}"`); continue; }
      if (rawAmt === 0) { skipped++; skippedRows.push(`Row ${i + 1}: zero amount skipped`); continue; }
      if (invert) rawAmt *= -1;

      const dateStr = row[dateIdx]?.replace(/"/g, '').trim() ?? '';
      if (!dateStr) { skipped++; skippedRows.push(`Row ${i + 1}: missing date`); continue; }
      const parts = dateStr.split(/[-/. ]/);
      let year: string | undefined, month: string | undefined, dayPart: string | undefined;

      // Helper: resolve a part that may be a numeric month or an abbreviated/full month name
      const resolveMonth = (s: string): string => MONTH_NAME_MAP[s.toLowerCase()] ?? s;

      if (parts.length >= 3) {
        const p0num = parseInt(parts[0]);
        const p2num = parseInt(parts[2] ?? '');
        if (p0num > 1900) {
          // ISO: YYYY-MM-DD (possibly with named month: 2024-Jan-15)
          year = parts[0]; month = resolveMonth(parts[1]); dayPart = parts[2];
        } else if (p2num > 1900) {
          // DD/MM/YYYY or MM/DD/YYYY or DD-Mon-YYYY — treat middle part as month
          year = parts[2]; month = resolveMonth(parts[1]); dayPart = parts[0];
        } else {
          // 2-digit year: YY-MM-DD or DD/MM/YY
          year = parts[2]; month = resolveMonth(parts[1]); dayPart = parts[0];
        }
      }
      if (year && year.length === 2) year = '20' + year;
      const monthInt = parseInt(month ?? '');
      const dayInt   = parseInt(dayPart ?? '0');
      if (!year || !month || isNaN(monthInt) || monthInt < 1 || monthInt > 12 || isNaN(dayInt) || dayInt < 1 || dayInt > 31) {
        skipped++; skippedRows.push(`Row ${i + 1}: unrecognised date "${dateStr}"`); continue;
      }
      // Reject calendar-impossible dates (e.g. Feb 30, Apr 31). new Date rolls over
      // to the next month for out-of-range days, so a mismatch means the day was invalid.
      if (new Date(parseInt(year, 10), monthInt - 1, dayInt).getDate() !== dayInt) {
        skipped++; skippedRows.push(`Row ${i + 1}: invalid date "${dateStr}" (day out of range for month)`); continue;
      }
      const monthKey = `${year}-${month.padStart(2, '0')}`;
      // Always store date in YYYY-MM-DD format regardless of input format
      const isoDate  = `${year}-${month.padStart(2, '0')}-${String(dayInt).padStart(2, '0')}`;
      const cleanDesc = (row[descIdx]?.replace(/"/g, '').trim().slice(0, MAX_DESC_LENGTH)) ?? 'Imported';
      const finalAmt  = Math.abs(rawAmt);
      const type      = rawAmt > 0 ? 'income' as const : 'expense' as const;

      // Skip exact duplicates (same date, description, amount, type)
      const importKey = `${isoDate}|${cleanDesc}|${finalAmt}|${type}`;
      if (existingKeys.has(importKey)) { skipped++; skippedRows.push(`Row ${i + 1}: duplicate skipped`); continue; }
      existingKeys.add(importKey); // prevent duplicates within the same import file too

      if (!db.transactions[monthKey]) db.transactions[monthKey] = [];
      db.transactions[monthKey].push({
        id: genId(), updatedAt: Date.now(),
        date: isoDate,
        desc: cleanDesc, amount: finalAmt, category: 'Imported', type,
      });
      count++;
    }

    save();
    let msg = `Imported ${count} transaction${count !== 1 ? 's' : ''}`;
    if (skipped > 0) msg += ` (${skipped} row${skipped !== 1 ? 's' : ''} skipped — see console for details)`;
    showToast(msg);
    if (skippedRows.length) console.warn('CSV import skipped rows:\n' + skippedRows.join('\n'));
    csvData = [];
    const csvFileEl = document.getElementById('csvFile') as HTMLInputElement | null;
    if (csvFileEl) csvFileEl.value = '';
    document.getElementById('csvMapper')?.classList.add('hidden');
    render();
  } catch (e: unknown) {
    showToast('Import error: ' + (e instanceof Error ? e.message : String(e)));
    console.error(e);
  }
}

// ─── Reset ────────────────────────────────────────────────────────────────────
export async function resetData(): Promise<void> {
  const answer = await showTextInputModal({
    title: 'Reset All Data',
    message: 'This permanently deletes all your data and cannot be undone.',
    label: 'Type RESET to confirm:',
    placeholder: 'RESET',
    confirmLabel: 'Delete Everything',
    dangerous: true,
  });
  if (answer?.trim() === 'RESET') {
    clearAndReload();
  } else if (answer !== null) {
    showToast('Reset cancelled — type RESET exactly to confirm');
  }
}

// ─── JSON backup restore ──────────────────────────────────────────────────────
export function importJsonBackup(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    let text: string;
    try { text = await file.text(); } catch { showToast('Could not read file'); return; }
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch { showToast('Invalid JSON — could not parse file'); return; }
    const txField = parsed['transactions'];
    if (
      typeof parsed['schemaVersion'] !== 'number' ||
      txField === null || txField === undefined ||
      typeof txField !== 'object' || Array.isArray(txField)
    ) {
      showToast('Invalid backup — expected a Finance Tracker JSON export');
      return;
    }
    // Validate critical numeric fields to prevent a malicious backup from
    // poisoning financial calculations with out-of-range values.
    const annualIncome = parsed['annualIncome'];
    if (annualIncome !== undefined && (typeof annualIncome !== 'number' || !isFinite(annualIncome) || annualIncome < 0)) {
      showToast('Invalid backup — annual income value is out of range');
      return;
    }
    const schemaVer = parsed['schemaVersion'];
    if (typeof schemaVer !== 'number' || schemaVer < 1 || schemaVer > 99) {
      showToast('Invalid backup — schema version is out of range');
      return;
    }
    const ok = await showConfirmModal({
      title: 'Restore from backup?',
      message: 'All current data will be replaced. Sync credentials (cloud URL & passphrase) are preserved.',
      confirmLabel: 'Restore',
      dangerous: true,
    });
    if (!ok) return;
    // Preserve sync credentials and API keys from current session — these are
    // device-specific secrets and should never be overwritten by an imported file.
    parsed['cloudURL'] = db.cloudURL;
    parsed['syncPassphrase'] = db.syncPassphrase;
    parsed['alphaVantageKey'] = db.alphaVantageKey;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    location.reload();
  };
  input.click();
}

// ─── Bank File Import (OFX / QIF) ─────────────────────────────────────────────
let _bankRows: BankRow[] = [];

const MAX_BANK_BYTES = 5 * 1024 * 1024; // 5 MB

export function handleBankFile(file: File): void {
  const name = file.name.toLowerCase();
  const isOFX = name.endsWith('.ofx') || name.endsWith('.qfx');
  const isQIF = name.endsWith('.qif');
  if (!isOFX && !isQIF) {
    showToast('Please upload a .ofx, .qfx, or .qif file'); return;
  }
  if (file.size > MAX_BANK_BYTES) {
    showToast('File too large — maximum 5 MB'); return;
  }
  const reader = new FileReader();
  reader.onload = (evt) => {
    const text = evt.target?.result as string;
    try {
      const rows = isOFX ? parseOFX(text) : parseQIF(text);
      if (rows.length === 0) { showToast('No transactions found in file'); return; }
      _bankRows = rows;
      // Show preview
      const previewEl = document.getElementById('bankImportPreview');
      const confirmBtn = document.getElementById('btnBankImportConfirm');
      if (previewEl) {
        previewEl.classList.remove('hidden');
        setText('bankImportCount', `${rows.length} transaction${rows.length !== 1 ? 's' : ''} ready to import.`);
      }
      if (confirmBtn) confirmBtn.classList.remove('hidden');
    } catch (e: unknown) {
      showToast('Parse error: ' + (e instanceof Error ? e.message : String(e)));
      _bankRows = [];
    }
  };
  reader.onerror = () => showToast('Could not read file');
  reader.readAsText(file, 'utf-8');
}

export function executeBankImport(): void {
  if (_bankRows.length === 0) { showToast('No file loaded — please choose a file first'); return; }

  // Fix #12: enforce row limit to prevent client-side DoS
  const MAX_BANK_IMPORT_ROWS = 10_000;
  if (_bankRows.length > MAX_BANK_IMPORT_ROWS) {
    showToast(`Import exceeds ${MAX_BANK_IMPORT_ROWS.toLocaleString()} rows — please split the file`);
    return;
  }

  // Fix #5: use JSON-serialised array as dedup key to prevent pipe-char collisions
  const existingKeys = new Set<string>();
  Object.values(db.transactions).forEach(txs =>
    txs.forEach(t => existingKeys.add(JSON.stringify([t.date ?? '', t.desc, t.amount, t.type]))),
  );

  let count = 0, skipped = 0;
  for (const row of _bankRows) {
    const finalAmt = Math.abs(row.amount);
    if (finalAmt === 0) { skipped++; continue; } // skip zero-value rows
    if (finalAmt > MAX_TX_AMOUNT) { skipped++; continue; } // Fix: reject unreasonably large amounts
    // Fix #10: use `< 0` not `>= 0` so -0 is never classified as income
    const type = row.amount < 0 ? 'expense' as const : 'income' as const;

    // Fix #5: JSON-based fingerprint prevents pipe-char injection collisions
    const importKey = JSON.stringify([row.date, row.desc, finalAmt, type]);
    if (existingKeys.has(importKey)) { skipped++; continue; }
    existingKeys.add(importKey);

    // Fix #4: validate monthKey before storing to prevent invalid keys in db
    const parts = row.date.split('-');
    const monthKey = `${parts[0]}-${parts[1]}`;
    if (!isValidMonthKey(monthKey)) { skipped++; continue; }

    if (!db.transactions[monthKey]) db.transactions[monthKey] = [];
    db.transactions[monthKey].push({
      id: genId(), updatedAt: Date.now(),
      date: row.date,
      desc: row.desc.slice(0, MAX_DESC_LENGTH),
      amount: finalAmt,
      category: 'Imported',
      type,
    });
    count++;
  }

  save();
  let msg = `Imported ${count} transaction${count !== 1 ? 's' : ''}`;
  if (skipped > 0) msg += ` (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)`;
  showToast(msg);

  // Reset UI
  _bankRows = [];
  const bankFileEl = document.getElementById('bankFile') as HTMLInputElement | null;
  if (bankFileEl) bankFileEl.value = '';
  document.getElementById('bankImportPreview')?.classList.add('hidden');
  document.getElementById('btnBankImportConfirm')?.classList.add('hidden');
  render();
}

// ─── Smart Recurring Suggestions ─────────────────────────────────────────────
export function acceptRecurringSuggestion(desc: string, amount: number, category: string): void {
  // Fix #9: validate inputs — guard against NaN/Infinity/zero amounts and oversized strings
  if (!isFinite(amount) || amount <= 0) { showToast('Invalid amount'); return; }
  if (amount > MAX_TX_AMOUNT) { showToast('Amount exceeds maximum'); return; }
  const safeDesc     = desc.trim().slice(0, MAX_DESC_LENGTH);
  const safeCategory = category.trim().slice(0, 50); // Fix #9: cap category length

  // Prevent duplicates (desc + rounded amount)
  const normDesc = safeDesc.toLowerCase().replace(/\s+/g, ' ');
  const exists = db.recurring.some(
    r => r.desc.trim().toLowerCase().replace(/\s+/g, ' ') === normDesc && Math.round(r.amount) === Math.round(amount),
  );
  if (exists) { showToast('Already in recurring templates'); return; }
  db.recurring.push({
    id: genId(),
    desc: safeDesc,
    amount,
    category: safeCategory,
    type: 'expense',
  });
  save();
  renderRecurring();
  renderRecurringSuggestions();
  showToast(`Added "${safeDesc}" as recurring expense`);
}

// ─── Phase 5A: Account management ────────────────────────────────────────────
export function addAccount(): void {
  const nameEl = inp('newAccountName');
  const name = (nameEl?.value ?? '').trim().slice(0, 50);
  if (!name) return showToast('Enter an account name');
  if (db.accounts.includes(name)) return showToast('Account already exists');
  db.accounts.push(name);
  save();
  if (nameEl) nameEl.value = '';
  renderAccounts();
  renderDropdowns(); // refresh account selectors
}

export async function delAccount(name: string): Promise<void> {
  if (db.accounts.length <= 1) return showToast('Keep at least one account');
  const txCount = Object.values(db.transactions).flat().filter(t => t.account === name).length;
  if (txCount > 0) {
    const ok = await showConfirmModal({
      title: 'Delete account?',
      message: `"${name}" is used on ${txCount} transaction${txCount !== 1 ? 's' : ''}. They'll become untagged.`,
      confirmLabel: 'Delete',
      dangerous: true,
    });
    if (!ok) return;
    // Unlink the account from all transactions
    Object.values(db.transactions).forEach(txs =>
      txs.forEach(t => { if (t.account === name) delete t.account; }),
    );
  }
  db.accounts = db.accounts.filter(a => a !== name);
  save();
  renderAccounts();
  renderDropdowns();
  render();
}

// ─── Phase 5D: Instalment plans ───────────────────────────────────────────────
export function createInstalment(): void {
  const descEl    = inp('instDesc');
  const amtEl     = inp('instAmt');
  const monthsEl  = inp('instMonths');
  const catEl     = sel('instCat');
  const startEl   = inp('instStart');
  const accountEl = sel('instAccount');

  const desc    = (descEl?.value ?? '').trim().slice(0, MAX_DESC_LENGTH);
  const total   = math(amtEl?.value ?? '');
  const months  = parseInt(monthsEl?.value ?? '');
  const cat     = catEl?.value ?? 'Bills';
  const start   = startEl?.value ?? getMonthPicker().value;
  const account = accountEl?.value || undefined;

  if (!desc) return showToast('Enter a description');
  if (!total || total <= 0) return showToast('Enter a valid total amount');
  if (total > MAX_TX_AMOUNT * 10) return showToast('Amount too large');
  if (!months || months < 2 || months > 120) return showToast('Months must be between 2 and 120');
  if (!isValidMonthKey(start)) return showToast('Invalid start month');

  const planId           = genId();
  // Integer cent arithmetic prevents floating-point drift across monthly instalments
  const totalCents       = Math.round(total * 100);
  const instalmentCents  = Math.floor(totalCents / months);
  const instalment       = instalmentCents / 100;
  let paidCents          = 0;

  const [startYear, startMonth] = start.split('-').map(Number);
  for (let i = 0; i < months; i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!isValidMonthKey(mk)) continue;
    if (!db.transactions[mk]) db.transactions[mk] = [];
    const isLast   = i === months - 1;
    const amtCents = isLast ? (totalCents - paidCents) : instalmentCents;
    const amt      = amtCents / 100;
    paidCents     += amtCents;
    db.transactions[mk].push({
      id: genId(), updatedAt: Date.now(),
      date: `${mk}-01`,
      desc: `${desc} (${i + 1}/${months})`,
      amount: amt,
      category: cat,
      type: 'expense',
      account,
      instalmentId: planId,
    });
  }

  const plan: InstalmentPlan = {
    id: planId, desc, totalAmount: total, months, startMonth: start, category: cat,
    type: 'expense', account,
  };
  db.instalmentPlans.push(plan);
  save();

  // Reset form
  if (descEl) descEl.value = '';
  if (amtEl) amtEl.value = '';
  if (monthsEl) monthsEl.value = '';
  showToast(`${months} monthly instalments of ${symFmt(instalment)} created`);
  render();
}

// ─── Phase 5E: Live price refresh ─────────────────────────────────────────────
let _priceRefreshBusy = false;

export async function refreshAssetPrices(): Promise<void> {
  if (_priceRefreshBusy) { showToast('Price refresh already in progress'); return; }
  _priceRefreshBusy = true;
  const btn = document.getElementById('btnRefreshPrices');
  if (btn) btn.classList.add('animate-spin');

  const tickerAssets = db.wealth.assets.filter(a => a.ticker);
  if (tickerAssets.length === 0) {
    showToast('No assets have ticker symbols — add one in the asset form');
    if (btn) btn.classList.remove('animate-spin');
    return;
  }

  let updated = 0, failed = 0;
  for (const asset of tickerAssets) {
    if (!asset.ticker) continue;
    const price = await fetchAssetPrice(asset.ticker, db.currency, db.alphaVantageKey);
    if (price !== null && price > 0) {
      const qty = asset.quantity ?? 1;
      asset.value = Math.round(price * qty * 100) / 100;
      asset.lastPriceUpdate = Date.now();
      asset.updatedAt = Date.now();
      updated++;
    } else {
      failed++;
    }
  }

  if (updated > 0) { save(); renderWealth(); }
  if (btn) btn.classList.remove('animate-spin');
  _priceRefreshBusy = false;
  const msg = updated > 0
    ? `Updated ${updated} asset price${updated !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`
    : `Could not fetch prices for ${failed} asset${failed !== 1 ? 's' : ''} — check ticker symbols`;
  showToast(msg);
}

// ─── Phase 5E: Save asset ticker ─────────────────────────────────────────────
export function saveAssetTicker(assetId: string, ticker: string, quantity: string): void {
  const asset = db.wealth.assets.find(a => a.id === assetId);
  if (!asset) return;
  const safeTicker = ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '').slice(0, 12);
  const qty        = parseFloat(quantity);
  asset.ticker   = safeTicker || undefined;
  asset.quantity = isFinite(qty) && qty > 0 ? qty : undefined;
  save();
  renderWealth();
  if (safeTicker) showToast(`Ticker set to ${safeTicker} — click Refresh Prices to update value`);
}

// ─── Phase 5C: Weekly digest preference ──────────────────────────────────────
export function saveWeeklyDigestPref(enabled: boolean): void {
  db.weeklyDigest = enabled;
  save();
}

export function saveAlphaVantageKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) { showToast('Enter a valid API key'); return; }
  db.alphaVantageKey = trimmed.slice(0, 64);
  clearPriceCache(); // stale prices no longer valid with new key
  save();
  // Clear the input field so the key is not visible in the DOM after saving
  const inputEl = document.getElementById('alphaVantageInput') as HTMLInputElement | null;
  if (inputEl) inputEl.value = '';
  // Show the "key saved" indicator
  document.getElementById('alphaKeyStatus')?.classList.remove('hidden');
  showToast('Alpha Vantage key saved');
}

// ─── Phase 5F: Tax year / reporting period ────────────────────────────────────
export function saveReportingPeriod(period: 'calendar' | 'tax'): void {
  db.reportingPeriod = period;
  save();
}

export function saveTaxYearMonth(month: number): void {
  if (month < 1 || month > 12) return;
  db.taxYearMonth = month;
  save();
}

// ─── Phase 5B: PDF / Print monthly statement ─────────────────────────────────
export function printMonthlyStatement(): void {
  // Trigger browser print — CSS @media print styles handle the layout
  window.print();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}
