import { db, save } from './db';
import { showToast } from './toast';
import { isValidMonthKey } from './finance';
import { encryptData, decryptData, isEncryptedEnvelope } from './crypto';

export function updateCloudStatus(): void {
  const dot   = document.getElementById('statusDot');
  const txt   = document.getElementById('statusText');
  const input = document.getElementById('cloudInput') as HTMLInputElement | null;
  const lock  = document.getElementById('encryptionBadge');

  if (input && db.cloudURL) input.value = db.cloudURL;

  if (db.cloudURL) {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
    if (txt) txt.innerText = 'Cloud Linked';
  } else {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-slate-400';
    if (txt) txt.innerText = 'Local Mode';
  }

  if (lock) {
    if (db.syncPassphrase) {
      lock.innerHTML = '<i class="fas fa-lock text-emerald-400 mr-1"></i><span class="text-emerald-400 text-xs font-medium">Encrypted</span>';
      lock.classList.remove('hidden');
    } else {
      lock.innerHTML = '<i class="fas fa-lock-open text-amber-400 mr-1"></i><span class="text-amber-400 text-xs font-medium">Unencrypted</span>';
      lock.classList.remove('hidden');
    }
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

export function saveSyncPassphrase(): void {
  const inp = document.getElementById('syncPassphraseInput') as HTMLInputElement | null;
  const raw = inp?.value ?? '';
  if (raw.length > 0 && raw.length < 8) {
    showToast('Passphrase must be at least 8 characters.'); return;
  }
  db.syncPassphrase = raw;
  save();
  updateCloudStatus();
  showToast(raw ? 'Encryption passphrase saved.' : 'Encryption disabled — syncing in plain text.');
  // Clear the field — the encryption badge shows current status; leaving bullets
  // would cause a second click to overwrite the real passphrase with '••••••••'.
  if (inp) inp.value = '';
}

export function clearSyncPassphrase(): void {
  db.syncPassphrase = '';
  save();
  const inp = document.getElementById('syncPassphraseInput') as HTMLInputElement | null;
  if (inp) inp.value = '';
  updateCloudStatus();
  showToast('Encryption passphrase cleared — syncing in plain text.');
}

/** Serialize the database, stripping credentials and transient render flags. */
function buildPayload(): typeof db {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cloudURL: _u, syncPassphrase: _p, ...rest } = db;
  // Strip _shifted (transient render flag) from bills — same as save() does for localStorage
  return { ...rest, bills: rest.bills.map(({ _shifted: _, ...b }) => b) } as typeof db;
}

export async function manualSync(ui = false): Promise<void> {
  if (!db.cloudURL) { if (ui) showToast('Please enter a Cloud URL in Settings.'); return; }
  const ind = document.getElementById('syncIndicator');
  const btn = document.getElementById('btnSync') as HTMLButtonElement | null;
  ind?.classList.remove('hidden');
  if (ui && btn) { btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Syncing...`; }

  try {
    // ── FETCH ────────────────────────────────────────────────────────────────
    // Build the fetch URL safely — the stored cloudURL may already contain a query string.
    const fetchURL = (() => {
      try {
        const u = new URL(db.cloudURL);
        u.searchParams.set('t', String(Date.now()));
        return u.toString();
      } catch {
        return db.cloudURL + '?t=' + Date.now();
      }
    })();
    const response = await fetch(fetchURL, { method: 'GET', redirect: 'follow' });
    if (!response.ok) throw new Error('Connection failed');

    const rawText = await response.text();

    let cloudData: typeof db & { status?: string };

    if (isEncryptedEnvelope(rawText)) {
      // Cloud blob is encrypted — we need a passphrase to read it
      if (!db.syncPassphrase) {
        throw new Error('Cloud data is encrypted but no passphrase is set. Enter your passphrase in Settings → Cloud Sync.');
      }
      const decrypted = await decryptData(rawText, db.syncPassphrase);
      cloudData = JSON.parse(decrypted) as typeof db & { status?: string };
    } else {
      // Legacy plain-text or first-time empty response
      try {
        cloudData = JSON.parse(rawText) as typeof db & { status?: string };
      } catch {
        // Empty or non-JSON response — treat as a fresh cloud slot
        cloudData = { status: 'new' } as typeof db & { status?: string };
      }
    }

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

      // billStatus — last-write-wins per bill entry using the 'updated' timestamp
      Object.keys(cloudData.billStatus ?? {}).forEach(date => {
        if (!isValidMonthKey(date)) return;
        const cloudMonth = cloudData.billStatus[date] ?? {};
        const localMonth = db.billStatus[date] ?? {};
        const merged: typeof localMonth = { ...localMonth };
        Object.keys(cloudMonth).forEach(billId => {
          const cloudEntry = cloudMonth[billId];
          const localEntry = localMonth[billId];
          const cloudTs = typeof cloudEntry === 'object' ? (cloudEntry.updated ?? 0) : 0;
          const localTs = typeof localEntry === 'object' ? (localEntry.updated ?? 0) : 0;
          if (!localEntry || cloudTs > localTs) merged[billId] = cloudEntry;
        });
        db.billStatus[date] = merged;
      });
    }

    // ── PUSH ─────────────────────────────────────────────────────────────────
    const payload = buildPayload();
    let body: string;

    if (db.syncPassphrase) {
      body = await encryptData(JSON.stringify(payload), db.syncPassphrase);
    } else {
      body = JSON.stringify(payload);
    }

    await fetch(db.cloudURL, {
      method: 'POST',
      body,
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
