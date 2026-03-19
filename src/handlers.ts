import { db, save, clearAndReload } from './db';
import { math, fmt, genId, esc } from './utils';
import { MAX_TX_AMOUNT, MAX_DESC_LENGTH } from './constants';
import { showToast } from './toast';
import {
  render,
  renderCalendar,
  renderWealth,
  renderDropdowns,
  renderSettingsCats,
  renderRecurring,
} from './render';
import { getMonthPicker } from './main';
import { getRollover, consolidateWealth } from './finance';
import type { AssetType } from './types';

export { consolidateWealth };

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
  const descEl = document.getElementById('txDesc') as HTMLInputElement | null;
  const amtEl = document.getElementById('txAmt') as HTMLInputElement | null;
  const catEl = document.getElementById('txCat') as HTMLSelectElement | null;

  const desc = descEl?.value.trim().slice(0, MAX_DESC_LENGTH) ?? '';
  const amt = math(amtEl?.value ?? '');
  const cat = catEl?.value ?? '';

  if (!desc) return showToast('Please enter a description');
  if (!amt || amt <= 0) return showToast('Please enter a valid positive amount');
  if (amt > MAX_TX_AMOUNT) return showToast(`Amount is unreasonably large (max £${MAX_TX_AMOUNT.toLocaleString()})`);
  if (cat === 'ADD_NEW') return showToast('Please select a valid category');

  if (editingTxId) {
    const txIndex = (db.transactions[k] ?? []).findIndex(t => t.id === editingTxId);
    if (txIndex > -1) {
      db.transactions[k][txIndex] = {
        ...db.transactions[k][txIndex],
        desc, amount: amt, category: cat, type: currentTxType, updatedAt: Date.now(),
      };
    }
    resetTxForm();
  } else {
    if (!db.transactions[k]) db.transactions[k] = [];
    db.transactions[k].push({ id: genId(), updatedAt: Date.now(), desc, amount: amt, category: cat, type: currentTxType });
    if (descEl) descEl.value = '';
    if (amtEl) amtEl.value = '';
  }
  save();
}

export function editTx(id: string): void {
  const k = getMonthPicker().value;
  const tx = (db.transactions[k] ?? []).find(t => t.id === id);
  if (!tx) return;
  editingTxId = id;
  (document.getElementById('txDesc') as HTMLInputElement).value = tx.desc;
  (document.getElementById('txAmt') as HTMLInputElement).value = String(tx.amount);
  (document.getElementById('txCat') as HTMLSelectElement).value = tx.category;
  setTxType(tx.type);
  setText('txFormTitle', 'Edit Transaction');
  (document.getElementById('btnSubmitTx') as HTMLButtonElement).innerHTML = 'Update Transaction';
  document.getElementById('btnCancelEdit')?.classList.remove('hidden');
}

export function resetTxForm(): void {
  editingTxId = null;
  (document.getElementById('txDesc') as HTMLInputElement).value = '';
  (document.getElementById('txAmt') as HTMLInputElement).value = '';
  const catSel = document.getElementById('txCat') as HTMLSelectElement | null;
  if (catSel?.options.length) catSel.selectedIndex = 0;
  setText('txFormTitle', 'Add Transaction');
  (document.getElementById('btnSubmitTx') as HTMLButtonElement).innerHTML = 'Add Transaction';
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
export function saveBill(): void {
  const name = (document.getElementById('billName') as HTMLInputElement).value.trim().slice(0, 100);
  const amt = math((document.getElementById('billAmt') as HTMLInputElement).value);
  const day = parseInt((document.getElementById('billDay') as HTMLInputElement).value);

  if (!name) return showToast('Please enter a bill name');
  if (!amt || amt <= 0) return showToast('Please enter a valid positive amount');
  if (!day || day < 1 || day > 31) return showToast('Day must be between 1 and 31');

  db.bills.push({ id: genId(), updatedAt: Date.now(), name, amount: amt, day });
  (document.getElementById('billName') as HTMLInputElement).value = '';
  (document.getElementById('billAmt') as HTMLInputElement).value = '';
  (document.getElementById('billDay') as HTMLInputElement).value = '';
  save();
  renderCalendar();
}

export function toggleBill(id: string): void {
  const key = getMonthPicker().value;
  if (!db.billStatus[key]) db.billStatus[key] = {};
  const bill = db.bills.find(b => b.id === id);
  if (!bill) return;
  const s = db.billStatus[key][id];
  const isPaid = typeof s === 'object' ? s.paid : !!s;

  if (!isPaid) {
    const txId = genId();
    db.billStatus[key][id] = { paid: true, updated: Date.now(), txId };
    if (!db.transactions[key]) db.transactions[key] = [];
    db.transactions[key].push({ id: txId, updatedAt: Date.now(), desc: bill.name, amount: math(bill.amount), category: 'Bills', type: 'expense' });
    save();
    showToast(`"${bill.name}" marked paid — added to expenses`, () => {
      db.billStatus[key][id] = { paid: false, updated: Date.now() };
      db.transactions[key] = (db.transactions[key] ?? []).filter(t => t.id !== txId);
      save();
    });
  } else {
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
  const backup = { ...bill };
  db.deletedIds.push(id);
  db.bills = db.bills.filter(b => b.id !== id);
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
  const name = (document.getElementById('assetName') as HTMLInputElement).value.trim().slice(0, 100);
  const val = math((document.getElementById('assetVal') as HTMLInputElement).value);
  const type = (document.getElementById('assetType') as HTMLSelectElement).value as AssetType;

  if (!name) return showToast('Please enter an asset name');
  if (isNaN(val) || val < 0) return showToast('Please enter a valid non-negative value');

  const existing = db.wealth.assets.find(a => a.name.trim().toLowerCase() === name.trim().toLowerCase());

  if (editingAssetId) {
    const idx = db.wealth.assets.findIndex(a => a.id === editingAssetId);
    if (idx > -1) db.wealth.assets[idx] = { ...db.wealth.assets[idx], name, value: val, type };
    cancelWealthEdit();
  } else {
    if (existing) {
      existing.value += val;
      showToast(`£${fmt(val)} added to "${existing.name}"`);
    } else {
      db.wealth.assets.push({ id: genId(), name, value: val, type });
    }
    (document.getElementById('assetName') as HTMLInputElement).value = '';
    (document.getElementById('assetVal') as HTMLInputElement).value = '';
  }
  consolidateWealth();
  save();
  renderWealth();
}

export function editAsset(id: string): void {
  const asset = db.wealth.assets.find(a => a.id === id);
  if (!asset) return;
  editingAssetId = id;
  (document.getElementById('assetName') as HTMLInputElement).value = asset.name;
  (document.getElementById('assetVal') as HTMLInputElement).value = String(asset.value);
  (document.getElementById('assetType') as HTMLSelectElement).value = asset.type ?? 'Other';
  (document.getElementById('btnSaveAsset') as HTMLButtonElement).innerHTML = '<i class="fas fa-save"></i>';
  document.getElementById('btnCancelAsset')?.classList.remove('hidden');
}

export function saveDebt(): void {
  const name = (document.getElementById('debtName') as HTMLInputElement).value.trim().slice(0, 100);
  const val = math((document.getElementById('debtVal') as HTMLInputElement).value);

  if (!name) return showToast('Please enter a liability name');
  if (isNaN(val) || val < 0) return showToast('Please enter a valid non-negative value');

  const existing = db.wealth.debts.find(d => d.name.trim().toLowerCase() === name.trim().toLowerCase());

  if (editingDebtId) {
    const idx = db.wealth.debts.findIndex(d => d.id === editingDebtId);
    if (idx > -1) db.wealth.debts[idx] = { ...db.wealth.debts[idx], name, value: val };
    cancelWealthEdit();
  } else {
    if (existing) {
      existing.value += val;
      showToast(`£${fmt(val)} added to "${existing.name}"`);
    } else {
      db.wealth.debts.push({ id: genId(), name, value: val });
    }
    (document.getElementById('debtName') as HTMLInputElement).value = '';
    (document.getElementById('debtVal') as HTMLInputElement).value = '';
  }
  consolidateWealth();
  save();
  renderWealth();
}

export function editDebt(id: string): void {
  const debt = db.wealth.debts.find(d => d.id === id);
  if (!debt) return;
  editingDebtId = id;
  (document.getElementById('debtName') as HTMLInputElement).value = debt.name;
  (document.getElementById('debtVal') as HTMLInputElement).value = String(debt.value);
  (document.getElementById('btnSaveDebt') as HTMLButtonElement).innerHTML = '<i class="fas fa-save"></i>';
  document.getElementById('btnCancelDebt')?.classList.remove('hidden');
}

export function cancelWealthEdit(): void {
  editingAssetId = null;
  editingDebtId = null;
  (document.getElementById('assetName') as HTMLInputElement).value = '';
  (document.getElementById('assetVal') as HTMLInputElement).value = '';
  (document.getElementById('debtName') as HTMLInputElement).value = '';
  (document.getElementById('debtVal') as HTMLInputElement).value = '';
  (document.getElementById('btnSaveAsset') as HTMLButtonElement).innerHTML = '+';
  (document.getElementById('btnSaveDebt') as HTMLButtonElement).innerHTML = '+';
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
  const debts = db.wealth.debts.reduce((a, b) => a + b.value, 0);
  const rollover = getRollover(key);
  const txs = db.transactions[key] ?? [];
  let inc = 0, exp = 0;
  txs.forEach(t => { if (t.type === 'income') inc += t.amount; else exp += t.amount; });
  const net = (assets + (inc + rollover) - exp) - debts;
  if (!db.wealth.history) db.wealth.history = {};
  db.wealth.history[key] = net;
  save();
  renderWealth();
  alert(`Logged Net Worth of £${fmt(net)} for ${key}`);
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
  const desc = (document.getElementById('recDesc') as HTMLInputElement).value.trim().slice(0, MAX_DESC_LENGTH);
  const amt = math((document.getElementById('recAmt') as HTMLInputElement).value);
  const cat = (document.getElementById('recCat') as HTMLSelectElement).value;
  if (!desc) return showToast('Enter a description');
  if (!amt || amt <= 0) return showToast('Enter a valid positive amount');
  db.recurring.push({ id: genId(), desc, amount: amt, category: cat, type: currentRecType });
  (document.getElementById('recDesc') as HTMLInputElement).value = '';
  (document.getElementById('recAmt') as HTMLInputElement).value = '';
  save();
  renderRecurring();
}

export function delRecurring(id: string): void {
  db.recurring = db.recurring.filter(r => r.id !== id);
  save();
  renderRecurring();
  showToast('Template removed');
}

export function applyRecurring(): void {
  if (!db.recurring || db.recurring.length === 0) {
    showToast('No templates set up — add them in Settings');
    return;
  }
  const key = getMonthPicker().value;
  if (!db.transactions[key]) db.transactions[key] = [];
  let count = 0;
  db.recurring.forEach(r => {
    const exists = db.transactions[key].some(t => t.desc === r.desc && t.amount === r.amount && t.type === r.type);
    if (!exists) {
      db.transactions[key].push({ id: genId(), updatedAt: Date.now(), desc: r.desc, amount: r.amount, category: r.category, type: r.type });
      count++;
    }
  });
  if (count > 0) { save(); showToast(`Applied ${count} recurring transaction${count > 1 ? 's' : ''}`); }
  else showToast('All recurring transactions already applied this month');
}

// ─── Annual income ────────────────────────────────────────────────────────────
export function editAnnualIncome(): void {
  const v = prompt('Annual Salary:', String(db.annualIncome));
  if (v !== null) { db.annualIncome = math(v); save(); }
}

// ─── CSV Import ───────────────────────────────────────────────────────────────
let csvData: string[][] = [];

export function handleCsvFile(file: File): void {
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
      const monthKey = `${year}-${month.padStart(2, '0')}`;
      const cleanDesc = (row[descIdx]?.replace(/"/g, '').trim().slice(0, MAX_DESC_LENGTH)) ?? 'Imported';
      const finalAmt = Math.abs(rawAmt);
      const type = rawAmt > 0 ? 'income' as const : 'expense' as const;

      if (!db.transactions[monthKey]) db.transactions[monthKey] = [];
      db.transactions[monthKey].push({ id: genId(), updatedAt: Date.now(), desc: cleanDesc, amount: finalAmt, category: 'Imported', type });
      count++;
    }

    save();
    let msg = `Imported ${count} transaction${count !== 1 ? 's' : ''}`;
    if (skipped > 0) msg += ` (${skipped} row${skipped !== 1 ? 's' : ''} skipped — see console for details)`;
    showToast(msg);
    if (skippedRows.length) console.warn('CSV import skipped rows:\n' + skippedRows.join('\n'));
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
