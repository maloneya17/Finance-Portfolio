import { db, save, clearAndReload } from './db';
import { math, fmt, genId, esc, setCurrencySymbol } from './utils';
import { MAX_TX_AMOUNT, MAX_DESC_LENGTH } from './constants';
import { showToast } from './toast';
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
    const txIndex = (db.transactions[k] ?? []).findIndex(t => t.id === editingTxId);
    if (txIndex > -1) {
      db.transactions[k][txIndex] = {
        ...db.transactions[k][txIndex],
        desc, amount: amt, category: cat, type: currentTxType,
        date: date || undefined, notes: notes || undefined,
        updatedAt: Date.now(),
      };
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
export function checkNewCategory(sel: HTMLSelectElement): void {
  if (sel.value !== 'ADD_NEW') return;
  const raw = prompt('New Category Name:');
  const n = raw?.trim().slice(0, 50) ?? '';
  if (n && !db.categories.includes(n)) {
    db.categories.push(n);
    save();
    renderDropdowns();
    sel.value = n;
  } else if (n) {
    sel.value = n;
  } else {
    sel.value = db.categories[0] ?? '';
  }
}

export function delCat(c: string): void {
  if (!confirm(`Delete '${c}'?`)) return;
  db.categories = db.categories.filter(x => x !== c);
  delete db.budgets[c];
  save();
  renderSettingsCats();
  renderDropdowns();
}

export function addCatPrompt(): void {
  const raw = prompt('Category Name:');
  const n = raw?.trim().slice(0, 50) ?? '';
  if (n && !db.categories.includes(n)) {
    db.categories.push(n);
    save();
    renderSettingsCats();
    renderDropdowns();
  } else if (n) {
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
    const txId = genId();
    db.billStatus[key][id] = { paid: true, updated: Date.now(), txId };
    if (!db.transactions[key]) db.transactions[key] = [];
    db.transactions[key].push({
      id: txId, updatedAt: Date.now(),
      date: new Date().toISOString().slice(0, 10),
      desc: bill.name, amount: math(bill.amount), category: billCat, type: 'expense',
    });
    save();
    showToast(`"${bill.name}" marked paid — added to expenses`, () => {
      db.billStatus[key][id] = { paid: false, updated: Date.now() };
      db.transactions[key] = (db.transactions[key] ?? []).filter(t => t.id !== txId);
      save();
    });
  } else {
    // Remove the auto-created expense transaction if it exists
    const prevStatus = db.billStatus[key][id];
    if (typeof prevStatus === 'object' && prevStatus.txId) {
      db.transactions[key] = (db.transactions[key] ?? []).filter(t => t.id !== prevStatus.txId);
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

  const existing = db.wealth.assets.find(a => a.name.trim().toLowerCase() === name.trim().toLowerCase());

  if (editingAssetId) {
    const idx = db.wealth.assets.findIndex(a => a.id === editingAssetId);
    if (idx > -1) db.wealth.assets[idx] = { ...db.wealth.assets[idx], name, value: val, type };
    cancelWealthEdit();
  } else {
    if (existing) {
      existing.value += val;
      showToast(`${db.currency}${fmt(val)} added to "${existing.name}"`);
    } else {
      db.wealth.assets.push({ id: genId(), name, value: val, type });
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
    if (idx > -1) db.wealth.debts[idx] = {
      ...db.wealth.debts[idx], name, value: val,
      // Use explicit check so user can clear the field (empty = remove the optional field)
      interestRate: rateRaw   ? interestRate   : undefined,
      minPayment:   minPayRaw ? minPayment     : undefined,
    };
    cancelWealthEdit();
  } else {
    if (existing) {
      existing.value += val;
      showToast(`${db.currency}${fmt(val)} added to "${existing.name}"`);
    } else {
      db.wealth.debts.push({ id: genId(), name, value: val, interestRate, minPayment });
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
  (db.wealth[type] as typeof db.wealth.assets) = db.wealth[type].filter(i => i.id !== id) as typeof db.wealth.assets;
  save();
  renderWealth();
  showToast(`Removed "${backup.name}"`, () => {
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
  showToast(`Logged Net Worth of ${db.currency}${fmt(net)} for ${key}`);
}

// ─── Savings Goals ────────────────────────────────────────────────────────────
let editingGoalId: string | null = null;

export function saveGoal(): void {
  const name    = (inp('goalName')?.value ?? '').trim().slice(0, MAX_DESC_LENGTH);
  const target  = math(inp('goalTarget')?.value ?? '');
  const current = math(inp('goalCurrent')?.value ?? '');
  const notes   = (inp('goalNotes')?.value ?? '').trim().slice(0, 200);

  if (!name) return showToast('Please enter a goal name');
  if (!target || target <= 0) return showToast('Please enter a valid target amount');

  if (editingGoalId) {
    const idx = db.goals.findIndex(g => g.id === editingGoalId);
    if (idx > -1) db.goals[idx] = { ...db.goals[idx], name, target, current, notes: notes || undefined };
    cancelGoalEdit();
  } else {
    db.goals.push({ id: genId(), name, target, current, notes: notes || undefined });
    if (inp('goalName'))    inp('goalName')!.value    = '';
    if (inp('goalTarget'))  inp('goalTarget')!.value  = '';
    if (inp('goalCurrent')) inp('goalCurrent')!.value = '';
    if (inp('goalNotes'))   inp('goalNotes')!.value   = '';
  }
  save();
  renderWealth();
}

export function editGoal(id: string): void {
  const goal = db.goals.find(g => g.id === id);
  if (!goal) return;
  editingGoalId = id;
  if (inp('goalName'))    inp('goalName')!.value    = goal.name;
  if (inp('goalTarget'))  inp('goalTarget')!.value  = String(goal.target);
  if (inp('goalCurrent')) inp('goalCurrent')!.value = String(goal.current);
  if (inp('goalNotes'))   inp('goalNotes')!.value   = goal.notes ?? '';
  const sbtn = btn('btnSaveGoal'); if (sbtn) sbtn.innerText = 'Update Goal';
  document.getElementById('btnCancelGoal')?.classList.remove('hidden');
  document.getElementById('goalSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function cancelGoalEdit(): void {
  editingGoalId = null;
  if (inp('goalName'))    inp('goalName')!.value    = '';
  if (inp('goalTarget'))  inp('goalTarget')!.value  = '';
  if (inp('goalCurrent')) inp('goalCurrent')!.value = '';
  if (inp('goalNotes'))   inp('goalNotes')!.value   = '';
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
  const val = (inp('currencySymbolInput')?.value ?? '').trim().slice(0, 3);
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
  db.recurring.push({ id: genId(), desc, amount: amt, category: cat, type: currentRecType });
  const rdEl = inp('recDesc'); if (rdEl) rdEl.value = '';
  const raEl = inp('recAmt');  if (raEl) raEl.value = '';
  save();
  renderRecurring();
}

export function delRecurring(id: string): void {
  db.recurring = db.recurring.filter(r => r.id !== id);
  save();
  renderRecurring();
  showToast('Template removed');
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
  db.recurring.forEach(r => {
    const exists = db.transactions[key].some(t => t.desc === r.desc && t.amount === r.amount && t.type === r.type && t.category === r.category);
    if (!exists) {
      db.transactions[key].push({
        id: genId(), updatedAt: Date.now(),
        date: new Date().toISOString().slice(0, 10),
        desc: r.desc, amount: r.amount, category: r.category, type: r.type,
      });
      count++;
    }
  });
  if (count > 0) {
    db.lastAutoAppliedMonth = key;
    save();
    if (!silent) showToast(`Applied ${count} recurring transaction${count > 1 ? 's' : ''}`);
  } else {
    if (!silent) showToast('All recurring transactions already applied this month');
  }
  return count;
}

// ─── Annual income ────────────────────────────────────────────────────────────
export function editAnnualIncome(): void {
  const v = prompt('Annual Salary:', String(db.annualIncome));
  if (v === null) return;
  const parsed = math(v);
  if (isNaN(parsed) || parsed < 0) return showToast('Please enter a valid non-negative salary');
  if (parsed > MAX_TX_AMOUNT * 10) return showToast('Value exceeds maximum allowed');
  db.annualIncome = parsed;
  save();
}

// ─── CSV Import ───────────────────────────────────────────────────────────────
let csvData: string[][] = [];

const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB

export function handleCsvFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.csv') && file.type && file.type !== 'text/csv') {
    showToast('Please upload a .csv file'); return;
  }
  if (file.size > MAX_CSV_BYTES) {
    showToast('File too large — maximum 5 MB'); return;
  }
  const reader = new FileReader();
  reader.onload = (evt) => {
    const text = evt.target?.result as string;
    const rows = text.split('\n').map(r => r.split(','));
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
    headers.forEach((h, i) => {
      const lower = h.toLowerCase();
      if (lower.includes('date')) (document.getElementById('mapDate') as HTMLSelectElement).value = String(i);
      if (lower.includes('desc') || lower.includes('detail')) (document.getElementById('mapDesc') as HTMLSelectElement).value = String(i);
      if (lower.includes('amount') || lower.includes('value')) (document.getElementById('mapAmt') as HTMLSelectElement).value = String(i);
    });
    document.getElementById('csvMapper')?.classList.remove('hidden');
    setText('csvPreview', `Loaded ${rows.length - 1} rows. Select columns above.`);
  };
  reader.readAsText(file);
}

export function executeImport(): void {
  try {
    const dateIdx = parseInt((document.getElementById('mapDate') as HTMLSelectElement).value);
    const descIdx = parseInt((document.getElementById('mapDesc') as HTMLSelectElement).value);
    const amtIdx  = parseInt((document.getElementById('mapAmt') as HTMLSelectElement).value);
    const invert  = (document.getElementById('mapInvert') as HTMLInputElement).checked;
    let count = 0, skipped = 0;
    const skippedRows: string[] = [];

    for (let i = 1; i < csvData.length; i++) {
      const row = csvData[i];
      if (row.length === 0 || (row.length === 1 && !row[0]?.trim())) continue;

      const rawAmtStr = row[amtIdx]?.replace(/[^0-9.-]/g, '') ?? '';
      let rawAmt = parseFloat(rawAmtStr);
      if (isNaN(rawAmt)) { skipped++; skippedRows.push(`Row ${i + 1}: invalid amount "${row[amtIdx] ?? ''}"`); continue; }
      if (invert) rawAmt *= -1;

      const dateStr = row[dateIdx]?.replace(/"/g, '').trim() ?? '';
      if (!dateStr) { skipped++; skippedRows.push(`Row ${i + 1}: missing date`); continue; }
      const parts = dateStr.split(/[-/.]/);
      let year: string | undefined, month: string | undefined;
      if (parts.length >= 3) {
        if (parseInt(parts[0]) > 1900) { year = parts[0]; month = parts[1]; }
        else if (parseInt(parts[2] ?? '') > 1900) { year = parts[2]; month = parts[1]; }
        else { year = parts[2]; month = parts[1]; }
      }
      if (year && year.length === 2) year = '20' + year;
      const monthInt = parseInt(month ?? '');
      if (!year || !month || isNaN(monthInt) || monthInt < 1 || monthInt > 12) {
        skipped++; skippedRows.push(`Row ${i + 1}: unrecognised date "${dateStr}"`); continue;
      }
      const monthKey  = `${year}-${month.padStart(2, '0')}`;
      const cleanDesc = (row[descIdx]?.replace(/"/g, '').trim().slice(0, MAX_DESC_LENGTH)) ?? 'Imported';
      const finalAmt  = Math.abs(rawAmt);
      const type      = rawAmt > 0 ? 'income' as const : 'expense' as const;

      if (!db.transactions[monthKey]) db.transactions[monthKey] = [];
      db.transactions[monthKey].push({
        id: genId(), updatedAt: Date.now(),
        date: dateStr.slice(0, 10),
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
    (document.getElementById('csvFile') as HTMLInputElement).value = '';
    document.getElementById('csvMapper')?.classList.add('hidden');
    render();
  } catch (e: unknown) {
    showToast('Import error: ' + (e instanceof Error ? e.message : String(e)));
    console.error(e);
  }
}

// ─── Reset ────────────────────────────────────────────────────────────────────
export function resetData(): void {
  const answer = prompt('Type RESET to permanently delete all your data. This cannot be undone.');
  if (answer?.trim() === 'RESET') {
    clearAndReload();
  } else if (answer !== null) {
    showToast('Reset cancelled — type RESET exactly to confirm');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}
