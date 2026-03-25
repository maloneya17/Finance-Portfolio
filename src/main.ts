import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { hasAccount, isLoggedIn, createAccount, verifyPin, logout, getStoredUsername, deleteAccount, changePin, startInactivityWatcher } from './auth';
import { db, save, syncFromStorage, STORAGE_KEY } from './db';
import { setThemeDefaults } from './charts';
import { render, renderBudgets, renderCalendar, renderWealth, renderReports, renderInsights, renderDropdowns, renderSettingsCats, renderRecurring, renderGoals, selectedTxIds, updateBulkBar } from './render';
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
  handleCsvFile, executeImport, importJsonBackup,
  bulkDeleteTx, bulkRecategorizeTx,
  addSplitRow, resetSplitPanel, updateSplitRemaining,
} from './handlers';
import { consolidateWealth, isValidMonthKey } from './finance';

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
  if (id === 'insights') renderInsights();
  // Note: render() below already calls renderBudgets() when the budget view is visible,
  // so we don't call it explicitly here to avoid a redundant double-render.
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
  const rows = [['Month', 'Date', 'Last Updated', 'Description', 'Category', 'Type', 'Amount', 'Notes'].map(csvEsc).join(',')];
  Object.keys(db.transactions).filter(isValidMonthKey).sort().forEach(month => {
    (db.transactions[month] ?? []).forEach(t => {
      rows.push([
        csvEsc(month),
        csvEsc(t.date ?? ''),   // actual transaction date (user-entered, YYYY-MM-DD)
        csvEsc(new Date(t.updatedAt ?? 0).toISOString().slice(0, 10)),
        csvEsc(t.desc ?? ''),
        csvEsc(t.category),
        csvEsc(t.type),
        csvEsc(t.amount),
        csvEsc(t.notes ?? ''),
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
        case 'lock': logout(); showAuthOverlay(); break;
        case 'toggle-theme': toggleTheme(); break;
        case 'toggle-privacy': togglePrivacy(); break;
        case 'sync': manualSync(true); break;
        case 'go-current-month': goToCurrentMonth(); break;
        case 'apply-recurring': applyRecurring(); break;
        case 'save-tx': {
          saveTransaction();
          // Brief success pulse on the submit button to confirm the save
          const submitBtn = document.getElementById('btnSubmitTx');
          if (submitBtn) {
            submitBtn.classList.remove('tx-save-success');
            // Reflow trick: force the browser to re-evaluate so re-adding the class restarts the animation
            void (submitBtn as HTMLElement).offsetWidth;
            submitBtn.classList.add('tx-save-success');
          }
          break;
        }
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
        case 'import-json': importJsonBackup(); break;
        case 'export-csv': exportCSV(); break;
        case 'reset-data': resetData(); break;
        case 'toggle-sidebar': toggleSidebar(); break;
        case 'bulk-delete': bulkDeleteTx(); break;
        case 'bulk-recat': {
          const catSel = document.getElementById('bulkCatSel') as HTMLSelectElement | null;
          bulkRecategorizeTx(catSel?.value ?? '');
          break;
        }
        case 'bulk-clear': selectedTxIds.clear(); render(); break;
        case 'toggle-split': {
          const panel = document.getElementById('splitPanel');
          if (!panel) break;
          if (panel.classList.contains('hidden')) {
            addSplitRow(); // adding first row opens the panel automatically
          } else {
            resetSplitPanel();
          }
          break;
        }
        case 'add-split-row': addSplitRow(); break;
        case 'toggle-filter': {
          const panel = document.getElementById('advFilterPanel');
          const btn   = document.getElementById('btnFilterToggle');
          if (panel) {
            const open = panel.classList.toggle('hidden') === false;
            btn?.setAttribute('aria-expanded', String(open));
          }
          break;
        }
        case 'clear-filters': {
          (document.getElementById('filterDateFrom') as HTMLInputElement | null)
            && ((document.getElementById('filterDateFrom') as HTMLInputElement).value = '');
          (document.getElementById('filterDateTo')   as HTMLInputElement | null)
            && ((document.getElementById('filterDateTo')   as HTMLInputElement).value = '');
          (document.getElementById('filterAmtMin')   as HTMLInputElement | null)
            && ((document.getElementById('filterAmtMin')   as HTMLInputElement).value = '');
          (document.getElementById('filterAmtMax')   as HTMLInputElement | null)
            && ((document.getElementById('filterAmtMax')   as HTMLInputElement).value = '');
          render();
          break;
        }
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

  // Transaction checkbox selection (delegated)
  root.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target.id === 'selectAllTx') {
      // Select / deselect all currently-visible filtered rows
      const visibleIds = Array.from(
        document.querySelectorAll<HTMLInputElement>('[data-tx-checkbox]'),
      ).map(cb => cb.dataset['txCheckbox']!);
      if (target.checked) visibleIds.forEach(id => selectedTxIds.add(id));
      else visibleIds.forEach(id => selectedTxIds.delete(id));
      render(); // re-render to sync checkbox states
      return;
    }
    if (target.dataset['txCheckbox']) {
      const id = target.dataset['txCheckbox']!;
      if (target.checked) selectedTxIds.add(id);
      else selectedTxIds.delete(id);
      updateBulkBar();
      // Update row highlight
      target.closest('tr')?.classList.toggle('bg-indigo-50', target.checked);
      target.closest('tr')?.classList.toggle('dark:bg-indigo-900/10', target.checked);
    }
  });

  // Search debounce
  const debouncedRender = debounce(render, 200);
  document.getElementById('txSearch')?.addEventListener('input', debouncedRender);
  // Keep split "Remaining" label live as user types the total amount
  document.getElementById('txAmt')?.addEventListener('input', updateSplitRemaining);

  // Category filter
  document.getElementById('txCatFilter')?.addEventListener('change', render);

  // Advanced filter inputs — re-render on any change
  ['filterDateFrom', 'filterDateTo', 'filterAmtMin', 'filterAmtMax'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', render);
  });

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

  // Mobile FAB — switch to transactions view and focus the description input
  document.getElementById('fabAddTx')?.addEventListener('click', () => {
    switchView('dashboard');
    setTimeout(() => {
      const txDesc = document.getElementById('txDesc') as HTMLInputElement | null;
      txDesc?.focus();
      txDesc?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  });

  // ─── Online / offline status indicator ─────────────────────────────────────
  function updateOfflineBanner(): void {
    const banner = document.getElementById('offlineBanner');
    if (!banner) return;
    if (navigator.onLine) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  }
  window.addEventListener('online',  updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
  updateOfflineBanner(); // initialise on boot
}

// ─── Auth overlay ─────────────────────────────────────────────────────────────
function showAuthOverlay(): void {
  const overlay = document.getElementById('authOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');

  if (hasAccount()) {
    document.getElementById('authSetup')?.classList.add('hidden');
    const loginPanel = document.getElementById('authLogin');
    loginPanel?.classList.remove('hidden');
    const welcome = document.getElementById('authWelcome');
    if (welcome) welcome.textContent = `Welcome back, ${getStoredUsername()}!`;
    // Clear any previous PIN + error, then focus
    const pinEl = document.getElementById('authLoginPin') as HTMLInputElement | null;
    if (pinEl) pinEl.value = '';
    document.getElementById('authLoginError')?.classList.add('hidden');
    setTimeout(() => pinEl?.focus(), 80);
  } else {
    document.getElementById('authLogin')?.classList.add('hidden');
    document.getElementById('authSetup')?.classList.remove('hidden');
    document.getElementById('authSetupError')?.classList.add('hidden');
    setTimeout(() => (document.getElementById('authUsername') as HTMLInputElement | null)?.focus(), 80);
  }
}

function hideAuthOverlay(): void {
  document.getElementById('authOverlay')?.classList.add('hidden');
}

/** Wires the auth overlay buttons (create account, unlock, forgot PIN). */
function wireAuthEvents(): void {
  // ── Create Account ──────────────────────────────────────────────────────────
  document.getElementById('btnCreateAccount')?.addEventListener('click', async () => {
    const username   = (document.getElementById('authUsername')   as HTMLInputElement).value;
    const pin        = (document.getElementById('authNewPin')     as HTMLInputElement).value;
    const confirmPin = (document.getElementById('authConfirmPin') as HTMLInputElement).value;
    const errorEl    = document.getElementById('authSetupError');
    const btnEl      = document.getElementById('btnCreateAccount') as HTMLButtonElement;

    if (pin !== confirmPin) {
      if (errorEl) { errorEl.textContent = 'PINs do not match.'; errorEl.classList.remove('hidden'); }
      return;
    }

    btnEl.disabled = true;
    btnEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Creating…';

    const err = await createAccount(username, pin);

    btnEl.disabled = false;
    btnEl.innerHTML = '<i class="fas fa-user-plus mr-2"></i>Create Account';

    if (err) {
      if (errorEl) { errorEl.textContent = err; errorEl.classList.remove('hidden'); }
    } else {
      errorEl?.classList.add('hidden');
      hideAuthOverlay();
      startInactivityWatcher();
      bootApp();
    }
  });

  // ── Unlock (Login) ──────────────────────────────────────────────────────────
  const doLogin = async (): Promise<void> => {
    const pinEl   = document.getElementById('authLoginPin') as HTMLInputElement;
    const errorEl = document.getElementById('authLoginError');
    const btnEl   = document.getElementById('btnUnlock') as HTMLButtonElement;

    btnEl.disabled = true;
    btnEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Verifying…';

    const err = await verifyPin(pinEl.value);

    btnEl.disabled = false;
    btnEl.innerHTML = '<i class="fas fa-unlock mr-2"></i>Unlock';

    if (err) {
      if (errorEl) { errorEl.textContent = err; errorEl.classList.remove('hidden'); }
      pinEl.value = '';
      // Shake animation on the input
      pinEl.classList.add('auth-shake');
      pinEl.addEventListener('animationend', () => pinEl.classList.remove('auth-shake'), { once: true });
    } else {
      errorEl?.classList.add('hidden');
      hideAuthOverlay();
      startInactivityWatcher();
      // Boot the app on the first successful login after a fresh page load.
      // If the user locked an already-booted session, bootApp() is a no-op.
      bootApp();
    }
  };

  document.getElementById('btnUnlock')?.addEventListener('click', doLogin);
  document.getElementById('authLoginPin')?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') void doLogin();
  });

  // ── Forgot PIN ──────────────────────────────────────────────────────────────
  document.getElementById('btnForgotPin')?.addEventListener('click', async () => {
    const ok = await import('./modal').then(m => m.showConfirmModal({
      title:   'Forgot PIN',
      message: 'This will remove your login credentials. Your portfolio data will NOT be deleted. You\'ll be asked to create a new account.',
      confirmLabel: 'Remove & Reset Login',
      dangerous: true,
    }));
    if (ok) {
      deleteAccount();
      (document.getElementById('authNewPin')     as HTMLInputElement).value = '';
      (document.getElementById('authConfirmPin') as HTMLInputElement).value = '';
      (document.getElementById('authUsername')   as HTMLInputElement).value = '';
      showAuthOverlay(); // re-show create-account panel
    }
  });

  // ── Change PIN (Settings view) ──────────────────────────────────────────────
  document.getElementById('btnChangePin')?.addEventListener('click', async () => {
    const currentEl = document.getElementById('changePinCurrent') as HTMLInputElement;
    const newEl     = document.getElementById('changePinNew')     as HTMLInputElement;
    const confirmEl = document.getElementById('changePinConfirm') as HTMLInputElement;
    const errorEl   = document.getElementById('changePinError');
    const successEl = document.getElementById('changePinSuccess');
    const btnEl     = document.getElementById('btnChangePin') as HTMLButtonElement;

    errorEl?.classList.add('hidden');
    successEl?.classList.add('hidden');
    btnEl.disabled = true;
    btnEl.textContent = 'Updating…';

    const err = await changePin(currentEl.value, newEl.value, confirmEl.value);

    btnEl.disabled = false;
    btnEl.textContent = 'Update PIN';

    if (err) {
      if (errorEl) { errorEl.textContent = err; errorEl.classList.remove('hidden'); }
    } else {
      currentEl.value = '';
      newEl.value     = '';
      confirmEl.value = '';
      successEl?.classList.remove('hidden');
    }
  });
}

/** Populates the Security card in Settings with the current username. */
function refreshAuthSettingsCard(): void {
  const card = document.getElementById('authSettingsCard');
  if (!card) return;
  if (hasAccount()) {
    card.classList.remove('hidden');
    const uEl = document.getElementById('authSettingsUsername');
    if (uEl) uEl.textContent = getStoredUsername();
  } else {
    card.classList.add('hidden');
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

/** Guard against bootApp() being called more than once (e.g. if auth events fire twice). */
let _appBooted = false;

/** Full app initialisation — only called after the user is authenticated. */
function bootApp(): void {
  if (_appBooted) return;
  _appBooted = true;

  const now = new Date();
  monthPickerEl = document.getElementById('monthPicker') as HTMLInputElement;
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
  refreshAuthSettingsCard();
  const currInput = document.getElementById('currencySymbolInput') as HTMLInputElement | null;
  if (currInput) currInput.value = db.currency;
  if (db.autoRecurring) {
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (db.lastAutoAppliedMonth !== currentMonthKey) applyRecurring(true);
  }
}

function boot(): void {
  wireAuthEvents();

  if (!isLoggedIn()) {
    showAuthOverlay();
    // bootApp() will be called once authentication succeeds.
    return;
  }

  bootApp();
}

document.addEventListener('DOMContentLoaded', boot);

// ─── Multi-tab storage sync ───────────────────────────────────────────────────
// When another tab saves data to the same localStorage key, reload our in-memory
// db so this tab doesn't blindly overwrite the other tab's changes on next save.
window.addEventListener('storage', (e: StorageEvent) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  syncFromStorage();
  // Refresh all views that might be visible and all data-driven components
  render();
  renderWealth();
  renderCalendar();
  renderDropdowns();      // categories may have changed in the other tab
  renderSettingsCats();   // ditto
  renderRecurring();      // recurring templates may have changed
  updateCloudStatus();
});

// ─── Service Worker (PWA) ─────────────────────────────────────────────────────
registerSW({
  onNeedRefresh() {
    showToast('New version available — tap to update.', () => window.location.reload());
  },
  onOfflineReady() {
    showToast('App ready to work offline.');
  },
});
