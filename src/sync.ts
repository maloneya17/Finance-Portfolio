import { db, save } from './db';
import { showToast } from './toast';
import { isValidMonthKey } from './finance';

export function updateCloudStatus(): void {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const input = document.getElementById('cloudInput') as HTMLInputElement | null;
  if (input && db.cloudURL) input.value = db.cloudURL;
  if (db.cloudURL) {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
    if (txt) txt.innerText = 'Cloud Linked';
  } else {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-slate-400';
    if (txt) txt.innerText = 'Local Mode';
  }
}

export function saveCloudUrl(): void {
  const url = (document.getElementById('cloudInput') as HTMLInputElement | null)?.value.trim() ?? '';
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      showToast('Cloud URL must start with https:// or http://'); return;
    }
  } catch {
    showToast('Please enter a valid URL (e.g. https://…)'); return;
  }
  db.cloudURL = url; save(); manualSync(true);
}

export async function manualSync(ui = false): Promise<void> {
  if (!db.cloudURL) { if (ui) showToast('Please enter a Cloud URL in Settings.'); return; }
  const ind = document.getElementById('syncIndicator');
  const btn = document.getElementById('btnSync') as HTMLButtonElement | null;
  ind?.classList.remove('hidden');
  if (ui && btn) { btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Syncing...`; }

  try {
    const response = await fetch(db.cloudURL + '?t=' + Date.now(), { method: 'GET', redirect: 'follow' });
    if (!response.ok) throw new Error('Connection failed');
    const cloudData = await response.json() as typeof db & { status?: string };

    if (cloudData.status !== 'new') {
      const allDeleted = new Set([...db.deletedIds, ...(cloudData.deletedIds ?? [])]);
      // Prune deletedIds to prevent unbounded localStorage growth
      const deletedArr = Array.from(allDeleted);
      db.deletedIds = deletedArr.length > 500 ? deletedArr.slice(deletedArr.length - 500) : deletedArr;

      // Bills — last-write-wins per id
      const billMap = new Map<string, typeof db.bills[0]>();
      [...db.bills, ...(cloudData.bills ?? [])].forEach(b => {
        if (!allDeleted.has(b.id)) {
          const ex = billMap.get(b.id);
          if (!ex || (b.updatedAt ?? 0) > (ex.updatedAt ?? 0)) billMap.set(b.id, b);
        }
      });
      db.bills = Array.from(billMap.values());

      // Assets — local wins
      const assetMap = new Map<string, typeof db.wealth.assets[0]>();
      (cloudData.wealth?.assets ?? []).forEach(a => assetMap.set(a.name, a));
      db.wealth.assets.forEach(a => assetMap.set(a.name, a));
      db.wealth.assets = Array.from(assetMap.values());

      const debtMap = new Map<string, typeof db.wealth.debts[0]>();
      (cloudData.wealth?.debts ?? []).forEach(d => debtMap.set(d.name, d));
      db.wealth.debts.forEach(d => debtMap.set(d.name, d));
      db.wealth.debts = Array.from(debtMap.values());

      if (cloudData.budgets) db.budgets = { ...cloudData.budgets, ...db.budgets };

      // Transactions — last-write-wins per tx id
      const allTx = new Map<string, typeof db.transactions[string][0] & { dateKey: string }>();
      Object.keys(cloudData.transactions ?? {}).forEach(date => {
        if (!isValidMonthKey(date)) return; // reject malformed/injected keys
        (cloudData.transactions[date] ?? []).forEach(t => {
          if (!allDeleted.has(t.id)) allTx.set(t.id, { ...t, dateKey: date });
        });
      });
      Object.keys(db.transactions).forEach(date => {
        if (!isValidMonthKey(date)) return; // skip any previously injected bad keys
        (db.transactions[date] ?? []).forEach(t => {
          if (!allDeleted.has(t.id)) {
            const ex = allTx.get(t.id);
            if (!ex || t.updatedAt >= ex.updatedAt) allTx.set(t.id, { ...t, dateKey: date });
          }
        });
      });
      db.transactions = {};
      allTx.forEach(t => {
        const k = t.dateKey;
        const { dateKey: _dk, ...rest } = t;
        if (!db.transactions[k]) db.transactions[k] = [];
        db.transactions[k].push(rest);
      });

      Object.keys(cloudData.billStatus ?? {}).forEach(date => {
        db.billStatus[date] = { ...db.billStatus[date], ...cloudData.billStatus[date] };
      });
    }

    await fetch(db.cloudURL, {
      method: 'POST',
      body: JSON.stringify(db),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });

    save(true);
    if (ui) showToast('Sync Successful!');
  } catch (e: unknown) {
    console.error(e);
    if (ui) showToast('Sync failed: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    setTimeout(() => ind?.classList.add('hidden'), 2000);
    if (ui && btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-cloud-upload-alt mr-2"></i> Sync Now`; }
  }
}
