import { db, save, persistOnly, clearAndReload, STORAGE_KEY } from './db';
import { math, fmt, genId, esc, setCurrencySymbol, symFmt } from './utils';
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
  selectedTxIds,
} from './render';
import { getMonthPicker } from './main';
import { getRollover, consolidateWealth } from './finance';
import type { AssetType } from './types';

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
  const activeExp = 'bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-300';
  const activeInc = 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300';
  const inactive = 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700';
  const btnExp = document.getElementById('btnExp');
  const btnInc = document.getElementById('btnInc');
  if (btnExp) btnExp.className = `flex-1 py-2 rounded-lg font-bold text-sm transition ${type === 'expense' ? activeExp : inactive}`;
  if (btnInc) btnInc.className = `flex-1 py-2 rounded-lg font-bold text-sm transition ${type === 'income' ? activeInc : inactive}`;
}

// ─── Transaction CRUD ─────────────────────────────────────────────────────────
let editingTxId: string | null = null;
/** Original month key when an edit was started — prevents saving to the wrong month
 *  if the user changes the month picker between clicking Edit and clicking Update. */
let editingTxMonth: string | null = null;

export function saveTransaction(): void {
  const k = getMonthPicker().value;
  const descEl  = document.getElementById('txDesc')  as HTMLInputElement | null;
  const amtEl   = document.getElementById('txAmt')   as HTMLInputElement | null;
  const catEl   = document.getElementById('txCat')   as HTMLSelectElement | null;
  const dateEl  = document.getElementById('txDate')  as HTMLInputElement | null;
  const notesEl = document.getElementById('txNotes') as HTMLInputElement | null;

  const desc  = descEl?.value.trim().slice(0, MAX_DESC_LENGTH) ?? '';
  const amt   = math(amtEl?.value ?? '');
  const cat   = catEl?.value ?? '';
  const date  = dateEl?.value ?? '';
  const notes = notesEl?.value.trim().slice(0, 200) ?? '';

  if (!desc) return showToast('Please enter a description');
  if (!amt || amt <= 0) return showToast('Please enter a valid positive amount');
  if (amt > MAX_TX_AMOUNT) return showToast(`Amount is unreasonably large (max ${db.currency}${MAX_TX_AMOUNT.toLocaleString()})`);
  if (cat === 'ADD_NEW') return showToast('Please select a valid category');

  if (editingTxId) {
    // Use the month where the tx originally lives, not the currently viewed month.
    const srcKey = editingTxMonth ?? k;
    const txIndex = (db.transactions[srcKey] ?? []).findIndex(t => t.id === editingTxId);
    if (txIndex > -1) {
      db.transactions[srcKey][txIndex] = {
        ...db.transactions[srcKey][txIndex],
        desc, amount: amt, category: cat, type: currentTxType,
        date: date || undefined, notes: notes || undefined,
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
      desc, amount: amt, category: cat, type: currentTxType,
      date: date || undefined, notes: notes || undefined,
    });
    if (descEl) descEl.value = '';
    if (amtEl)  amtEl.value  = '';
    if (notesEl) notesEl.value = '';
    // Keep date as today, keep category for fast repeat entry
  }
  save();
}

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
  const txCatEl   = sel('txCat');   if (txCatEl?.options.length) txCatEl.selectedIndex = 0;
  setText('txFormTitle', 'Add Transaction');
  const submitBtn = btn('btnSubmitTx'); if (submitBtn) submitBtn.innerHTML = 'Add Transaction';
  document.getElementById('btnCancelEdit')?.classList.add('hidden');
  setTxType('expense');
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
  const name = (inp('assetName')?.value ?? '').trim().slice(0, 100);
  const val  = math(inp('assetVal')?.value ?? '');
  const type = (sel('assetType')?.value ?? 'Other') as AssetType;

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
      db.wealth.assets[idx] = { ...db.wealth.assets[idx], name, value: val, type, updatedAt: Date.now() };
    }
    cancelWealthEdit();
  } else {
    if (existing) {
      existing.value += val;
      existing.updatedAt = Date.now();
      showToast(`${db.currency}${fmt(val)} added to "${existing.name}"`);
    } else {
      db.wealth.assets.push({ id: genId(), name, value: val, type, updatedAt: Date.now() });
    }
    const anEl = inp('assetName'); if (anEl) anEl.value = '';
    const avEl = inp('assetVal');  if (avEl) avEl.value = '';
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
  const anEl = inp('assetName'); if (anEl) anEl.value = asset.name;
  const avEl = inp('assetVal');  if (avEl) avEl.value = String(asset.value);
  const atEl = sel('assetType'); if (atEl) atEl.value = asset.type ?? 'Other';
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
  const assets = db.wealth.assets.reduce((a, b) => a + b.value, 0);
  const debts  = db.wealth.debts.reduce((a, b) => a + b.value, 0);
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

// ─── Currency ─────────────────────────────────────────────────────────────────
export function saveCurrency(): void {
  // Strip HTML-unsafe chars — the symbol is interpolated into innerHTML in render.ts
  const val = (inp('currencySymbolInput')?.value ?? '').trim().slice(0, 5).replace(/[<>&"']/g, '');
  if (!val) return showToast('Please enter a currency symbol');
  db.currency = val;
  setCurrencySymbol(val);
  save();
  showToast(`Currency set to "${val}"`);
}

// ─── Recurring templates ──────────────────────────────────────────────────────
let currentRecType: 'income' | 'expense' = 'expense';

export function setRecType(type: 'income' | 'expense'): void {
  currentRecType = type;
  const isExp = type === 'expense';
  const btnExp = document.getElementById('recBtnExp');
  const btnInc = document.getElementById('recBtnInc');
  if (btnExp) btnExp.className = `py-1.5 rounded-md text-xs font-bold transition ${isExp ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`;
  if (btnInc) btnInc.className = `py-1.5 rounded-md text-xs font-bold transition ${!isExp ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`;
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
    if (typeof parsed['schemaVersion'] !== 'number' || !parsed['transactions']) {
      showToast('Invalid backup — expected a Finance Tracker JSON export');
      return;
    }
    const ok = await showConfirmModal({
      title: 'Restore from backup?',
      message: 'All current data will be replaced. Sync credentials (cloud URL & passphrase) are preserved.',
      confirmLabel: 'Restore',
      dangerous: true,
    });
    if (!ok) return;
    // Preserve sync credentials from current session; restore everything else
    parsed['cloudURL'] = db.cloudURL;
    parsed['syncPassphrase'] = db.syncPassphrase;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    location.reload();
  };
  input.click();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}
