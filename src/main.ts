import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { db, save } from './db';
import { setThemeDefaults } from './charts';
import { render, renderBudgets, renderCalendar, renderWealth, renderReports, renderDropdowns, renderSettingsCats, renderRecurring, renderGoals } from './render';
import { showToast, handleToastUndo } from './toast';
import { updateCloudStatus, saveCloudUrl, manualSync, saveSyncPassphrase, clearSyncPassphrase } from './sync';
import { debounce, math, setCurrencySymbol, csvEsc, sym } from './utils';
import {
  setTxType, saveTransaction, editTx, resetTxForm, delTx, checkNewCategory,
  saveBill, editBill, cancelBillEdit, toggleBill, delBill,
  saveAsset, editAsset, saveDebt, editDebt, cancelWealthEdit, delWealthItem,
  logNetWorth,
  saveGoal, editGoal, delGoal, cancelGoalEdit,
  saveCurrency,
  setRecType, saveRecurring, delRecurring, applyRecurring,
  editAnnualIncome, resetData, addCatPrompt, delCat,
  handleCsvFile, executeImport,
} from './handlers';
import { consolidateWealth } from './finance';

// ─── Month picker ─────────────────────────────────────────────────────────────
let monthPickerEl: HTMLInputElement;

export function getMonthPicker(): HTMLInputElement {
  return monthPickerEl;
}

// ─── Wire save/render into db module ─────────────────────────────────────────
(window as Window & { _fpRender?: () => void })._fpRender = render;
(window as Window & { _fpUpdateCloudStatus?: () => void })._fpUpdateCloudStatus = updateCloudStatus;

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(): void {
  const html = document.documentElement;
  const label = document.getElementById('themeLabel');
  const isDark = db.theme === 'dark';
  if (isDark) {
    html.classList.add('dark');
    if (label) label.innerText = 'Light Mode';
  } else {
    html.classList.remove('dark');
    if (label) label.innerText = 'Dark Mode';
  }
  setThemeDefaults(isDark);
  // Rebuild visible charts with new colours
  if (!document.getElementById('view-dashboard')?.classList.contains('hidden')) render();
  if (!document.getElementById('view-reports')?.classList.contains('hidden')) { try { renderReports(); } catch { /* */ } }
  if (!document.getElementById('view-wealth')?.classList.contains('hidden')) { try { renderWealth(); } catch { /* */ } }
}

function toggleTheme(): void { db.theme = db.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); }

// ─── Privacy ──────────────────────────────────────────────────────────────────
let isPrivacyMode = false;
function togglePrivacy(): void {
  isPrivacyMode = !isPrivacyMode;
  if (isPrivacyMode) {
    document.body.classList.add('privacy-active');
    const lbl = document.getElementById('privacyLabel'); if (lbl) lbl.innerText = 'Show Figures';
    const icon = document.getElementById('privacyIcon'); if (icon) icon.className = 'fas fa-eye';
  } else {
    document.body.classList.remove('privacy-active');
    const lbl = document.getElementById('privacyLabel'); if (lbl) lbl.innerText = 'Hide Figures';
    const icon = document.getElementById('privacyIcon'); if (icon) icon.className = 'fas fa-eye-slash';
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function switchView(id: string): void {
  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
  const el = document.getElementById(`view-${id}`);
  if (!el) return;
  el.classList.remove('hidden', 'view-enter');
  void el.offsetWidth; // force reflow
  el.classList.add('view-enter');
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.remove('active', 'bg-indigo-600', 'text-white', 'shadow-lg');
    n.removeAttribute('aria-current');
  });
  const nav = document.getElementById(`nav-${id}`);
  if (nav) {
    nav.classList.add('active', 'bg-indigo-600', 'text-white', 'shadow-lg');
    nav.classList.remove('text-slate-400', 'hover:bg-slate-800');
    nav.setAttribute('aria-current', 'page');
  }
  if (id === 'reports') renderReports();
  if (id === 'bills') renderCalendar();
  if (id === 'wealth') renderWealth();
  if (id === 'budget') renderBudgets();
  render();
  // Close sidebar on mobile
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('open');
}

function goToCurrentMonth(): void {
  const now = new Date();
  monthPickerEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  render();
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function toggleSidebar(): void {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebarOverlay')?.classList.toggle('open');
}

// ─── Currency prefix updater ──────────────────────────────────────────────────
export function updateCurrencyPrefixes(): void {
  document.querySelectorAll<HTMLElement>('.curr-prefix').forEach(el => {
    el.textContent = sym();
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportJSON(): void {
  // Omit credentials from backup — cloudURL grants cloud access; syncPassphrase
  // would allow anyone with the file to decrypt synced data.
  const { cloudURL: _url, syncPassphrase: _pass, ...exportData } = db;
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  a.href = objectUrl;
  a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revocation — revoking synchronously can cancel the download on some browsers
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  showToast('JSON backup downloaded');
}

function exportCSV(): void {
  const rows = [['Month', 'Date Added', 'Description', 'Category', 'Type', 'Amount'].map(csvEsc).join(',')];
  Object.keys(db.transactions).sort().forEach(month => {
    (db.transactions[month] ?? []).forEach(t => {
      rows.push([
        csvEsc(month),
        csvEsc(new Date(t.updatedAt ?? 0).toISOString().slice(0, 10)),
        csvEsc(t.desc ?? ''),
        csvEsc(t.category),
        csvEsc(t.type),
        csvEsc(t.amount),
      ].join(','));
    });
  });
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  a.href = objectUrl;
  a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  showToast('CSV exported successfully');
}

// ─── Delegated event listeners ────────────────────────────────────────────────
function wireEvents(): void {
  const root = document.body;

  // Delegated click handler
  root.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-action]');

    // Undo toast
    handleToastUndo(e);

    // Transaction list
    const editTxBtn = target.closest<HTMLElement>('[data-edit-tx]');
    if (editTxBtn) { editTx(editTxBtn.dataset['editTx']!); return; }
    const delTxBtn = target.closest<HTMLElement>('[data-del-tx]');
    if (delTxBtn) { delTx(delTxBtn.dataset['delTx']!); return; }

    // Calendar
    const editBillEl = target.closest<HTMLElement>('[data-edit-bill]');
    if (editBillEl) { e.stopPropagation(); editBill(editBillEl.dataset['editBill']!); return; }
    const toggleBillEl = target.closest<HTMLElement>('[data-toggle-bill]');
    if (toggleBillEl && !target.closest('[data-del-bill]') && !target.closest('[data-edit-bill]')) { toggleBill(toggleBillEl.dataset['toggleBill']!); return; }
    const delBillEl = target.closest<HTMLElement>('[data-del-bill]');
    if (delBillEl) { e.stopPropagation(); delBill(delBillEl.dataset['delBill']!); return; }

    // Wealth
    const editAssetEl = target.closest<HTMLElement>('[data-edit-asset]');
    if (editAssetEl) { editAsset(editAssetEl.dataset['editAsset']!); return; }
    const editDebtEl = target.closest<HTMLElement>('[data-edit-debt]');
    if (editDebtEl) { editDebt(editDebtEl.dataset['editDebt']!); return; }
    const delWealthEl = target.closest<HTMLElement>('[data-del-wealth]');
    if (delWealthEl) {
      const [type, id] = delWealthEl.dataset['delWealth']!.split(':');
      delWealthItem(type as 'assets' | 'debts', id);
      return;
    }

    // Settings categories
    const delCatEl = target.closest<HTMLElement>('[data-del-cat]');
    if (delCatEl) { delCat(delCatEl.dataset['delCat']!); return; }

    // Goals
    const editGoalEl = target.closest<HTMLElement>('[data-edit-goal]');
    if (editGoalEl) { editGoal(editGoalEl.dataset['editGoal']!); return; }
    const delGoalEl = target.closest<HTMLElement>('[data-del-goal]');
    if (delGoalEl) { delGoal(delGoalEl.dataset['delGoal']!); return; }

    // Recurring
    const delRecEl = target.closest<HTMLElement>('[data-del-recurring]');
    if (delRecEl) { delRecurring(delRecEl.dataset['delRecurring']!); return; }

    if (btn) {
      const action = btn.dataset['action'];
      switch (action) {
        case 'toggle-theme': toggleTheme(); break;
        case 'toggle-privacy': togglePrivacy(); break;
        case 'sync': manualSync(true); break;
        case 'go-current-month': goToCurrentMonth(); break;
        case 'apply-recurring': applyRecurring(); break;
        case 'save-tx': saveTransaction(); break;
        case 'cancel-edit-tx': resetTxForm(); break;
        case 'save-bill': saveBill(); break;
        case 'cancel-bill': cancelBillEdit(); break;
        case 'save-asset': saveAsset(); break;
        case 'cancel-asset': cancelWealthEdit(); break;
        case 'save-debt': saveDebt(); break;
        case 'cancel-debt': cancelWealthEdit(); break;
        case 'log-net-worth': logNetWorth(); break;
        case 'save-goal': saveGoal(); break;
        case 'cancel-goal': cancelGoalEdit(); break;
        case 'save-currency': saveCurrency(); updateCurrencyPrefixes(); break;
        case 'save-recurring': saveRecurring(); break;
        case 'edit-annual-income': editAnnualIncome(); break;
        case 'add-cat': addCatPrompt(); break;
        case 'import-csv': executeImport(); break;
        case 'save-cloud-url': saveCloudUrl(); break;
        case 'save-sync-passphrase': saveSyncPassphrase(); break;
        case 'clear-sync-passphrase': clearSyncPassphrase(); break;
        case 'export-json': exportJSON(); break;
        case 'export-csv': exportCSV(); break;
        case 'reset-data': resetData(); break;
        case 'toggle-sidebar': toggleSidebar(); break;
      }
    }
  });

  // Nav items
  root.addEventListener('click', (e: MouseEvent) => {
    const nav = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
    if (nav) switchView(nav.dataset['nav']!);
  });
  root.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const nav = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
    if (nav) { e.preventDefault(); switchView(nav.dataset['nav']!); }
  });

  // Tx type toggle
  document.getElementById('btnExp')?.addEventListener('click', () => setTxType('expense'));
  document.getElementById('btnInc')?.addEventListener('click', () => setTxType('income'));

  // Rec type toggle
  document.getElementById('recBtnExp')?.addEventListener('click', () => setRecType('expense'));
  document.getElementById('recBtnInc')?.addEventListener('click', () => setRecType('income'));

  // Category dropdown — "Add New" check
  document.getElementById('txCat')?.addEventListener('change', (e) => checkNewCategory(e.target as HTMLSelectElement));

  // Search debounce
  const debouncedRender = debounce(render, 200);
  document.getElementById('txSearch')?.addEventListener('input', debouncedRender);

  // Category filter
  document.getElementById('txCatFilter')?.addEventListener('change', render);

  // Month picker
  monthPickerEl.addEventListener('change', render);

  // CSV file input
  document.getElementById('csvFile')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleCsvFile(file);
  });

  // Cloud form submit
  document.getElementById('formCloud')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveCloudUrl();
  });

  // Reports year select
  document.getElementById('reportYearSelect')?.addEventListener('change', renderReports);

  // Auto-recurring toggle
  const autoToggle = document.getElementById('autoRecurringToggle') as HTMLInputElement | null;
  if (autoToggle) {
    autoToggle.checked = db.autoRecurring;
    autoToggle.addEventListener('change', () => {
      db.autoRecurring = autoToggle.checked;
      save();
    });
  }

  // Sidebar overlay click
  document.getElementById('sidebarOverlay')?.addEventListener('click', toggleSidebar);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
function boot(): void {
  monthPickerEl = document.getElementById('monthPicker') as HTMLInputElement;
  const now = new Date();
  monthPickerEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  setCurrencySymbol(db.currency);
  wireEvents();
  updateCurrencyPrefixes();
  consolidateWealth();
  renderDropdowns();
  applyTheme();
  render();
  renderSettingsCats();
  renderWealth();
  updateCloudStatus();
  renderRecurring();
  const currInput = document.getElementById('currencySymbolInput') as HTMLInputElement | null;
  if (currInput) currInput.value = db.currency;
  if (db.autoRecurring) {
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (db.lastAutoAppliedMonth !== currentMonthKey) applyRecurring(true);
  }
}

document.addEventListener('DOMContentLoaded', boot);

// ─── Service Worker (PWA) ─────────────────────────────────────────────────────
registerSW({
  onNeedRefresh() {
    showToast('New version available — tap to update.', () => window.location.reload());
  },
  onOfflineReady() {
    showToast('App ready to work offline.');
  },
});
