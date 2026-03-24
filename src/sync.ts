import { db, save } from './db';
import { showToast } from './toast';
import { isValidMonthKey } from './finance';
import { encryptData, decryptData, isEncryptedEnvelope } from './crypto';

// Guard against concurrent syncs (double-click, or save-URL triggering a second sync while one is running)
let syncInProgress = false;

// 10 MB response limit — protects against malicious/runaway cloud endpoints
const MAX_SYNC_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Safely return an array from a value that should be an array (guards against corrupted cloud data). */
function safeArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

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
  if (syncInProgress) { if (ui) showToast('Sync already in progress…'); return; }
  syncInProgress = true;

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

    // Enforce response size limit before reading body
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_SYNC_RESPONSE_BYTES) {
      throw new Error('Cloud response too large (> 10 MB). Data may be corrupted.');
    }
    const rawText = await response.text();
    if (rawText.length > MAX_SYNC_RESPONSE_BYTES) {
      throw new Error('Cloud response too large (> 10 MB). Data may be corrupted.');
    }

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
      [...db.bills, ...safeArr<typeof db.bills[0]>(cloudData.bills)].forEach(b => {
        if (!allDeleted.has(b.id)) {
          const ex = billMap.get(b.id);
          if (!ex || (b.updatedAt ?? 0) > (ex.updatedAt ?? 0)) billMap.set(b.id, b);
        }
      });
      db.bills = Array.from(billMap.values());

      // Assets — last-write-wins per id using updatedAt; ties go to local.
      // Legacy assets without updatedAt use 0 so newer entries always win.
      const assetMap = new Map<string, typeof db.wealth.assets[0]>();
      [...safeArr<typeof db.wealth.assets[0]>(cloudData.wealth?.assets), ...db.wealth.assets].forEach(a => {
        if (allDeleted.has(a.id)) return;
        const ex = assetMap.get(a.id);
        if (!ex || (a.updatedAt ?? 0) >= (ex.updatedAt ?? 0)) assetMap.set(a.id, a);
      });
      db.wealth.assets = Array.from(assetMap.values());

      // Debts — last-write-wins per id using updatedAt
      const debtMap = new Map<string, typeof db.wealth.debts[0]>();
      [...safeArr<typeof db.wealth.debts[0]>(cloudData.wealth?.debts), ...db.wealth.debts].forEach(d => {
        if (allDeleted.has(d.id)) return;
        const ex = debtMap.get(d.id);
        if (!ex || (d.updatedAt ?? 0) >= (ex.updatedAt ?? 0)) debtMap.set(d.id, d);
      });
      db.wealth.debts = Array.from(debtMap.values());

      // Budgets — cloud contributes missing categories; local wins for existing keys.
      // This ensures a budget deleted locally is not resurrected by the next sync.
      if (cloudData.budgets) {
        Object.entries(cloudData.budgets as Record<string, number>).forEach(([cat, val]) => {
          if (!(cat in db.budgets)) db.budgets[cat] = val;
        });
      }

      // Categories — union: add any cloud categories not present locally.
      // Preserve local ordering; append new cloud-only categories at end.
      if (Array.isArray(cloudData.categories)) {
        const newCats = safeArr<string>(cloudData.categories).filter(
          c => typeof c === 'string' && c.length > 0 && !db.categories.includes(c),
        );
        if (newCats.length) db.categories = [...db.categories, ...newCats];
      }

      // Goals — merge by id; local copy wins on conflict (no updatedAt on goals)
      if (Array.isArray(cloudData.goals)) {
        const goalMap = new Map<string, typeof db.goals[0]>();
        safeArr<typeof db.goals[0]>(cloudData.goals).forEach(g => {
          if (!allDeleted.has(g.id)) goalMap.set(g.id, g);
        });
        db.goals.forEach(g => { if (!allDeleted.has(g.id)) goalMap.set(g.id, g); });
        db.goals = Array.from(goalMap.values());
      }

      // Recurring templates — merge by id; local wins on conflict
      if (Array.isArray(cloudData.recurring)) {
        const recMap = new Map<string, typeof db.recurring[0]>();
        safeArr<typeof db.recurring[0]>(cloudData.recurring).forEach(r => {
          if (!allDeleted.has(r.id)) recMap.set(r.id, r);
        });
        db.recurring.forEach(r => { if (!allDeleted.has(r.id)) recMap.set(r.id, r); });
        db.recurring = Array.from(recMap.values());
      }

      // Annual income — last-write-wins using annualIncomeUpdatedAt timestamp.
      // Falls back to "adopt cloud only if local is 0" for entries without timestamps.
      if (typeof cloudData.annualIncome === 'number' && cloudData.annualIncome > 0) {
        const cloudTs = typeof cloudData.annualIncomeUpdatedAt === 'number' ? cloudData.annualIncomeUpdatedAt : 0;
        const localTs = db.annualIncomeUpdatedAt ?? 0;
        if (cloudTs > localTs) {
          db.annualIncome = cloudData.annualIncome;
          db.annualIncomeUpdatedAt = cloudTs;
        } else if (localTs === 0 && db.annualIncome === 0) {
          db.annualIncome = cloudData.annualIncome; // legacy: adopt if local never set
        }
      }

      // Transactions — last-write-wins per tx id
      const allTx = new Map<string, typeof db.transactions[string][0] & { dateKey: string }>();
      Object.keys(cloudData.transactions ?? {}).forEach(date => {
        if (!isValidMonthKey(date)) return; // reject malformed/injected keys
        safeArr<typeof db.transactions[string][0]>(cloudData.transactions[date]).forEach(t => {
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

    // ── PERSIST MERGE ────────────────────────────────────────────────────────
    // Persist the merged local state immediately so a failed push doesn't lose
    // the data we just pulled from the cloud.
    save(true);

    // ── PUSH ─────────────────────────────────────────────────────────────────
    const payload = buildPayload();
    let body: string;

    if (db.syncPassphrase) {
      body = await encryptData(JSON.stringify(payload), db.syncPassphrase);
    } else {
      body = JSON.stringify(payload);
    }

    const pushRes = await fetch(db.cloudURL, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
    if (!pushRes.ok) throw new Error(`Upload failed (${pushRes.status} ${pushRes.statusText})`);

    if (ui) showToast('Sync Successful!');
  } catch (e: unknown) {
    console.error(e);
    if (ui) showToast('Sync failed: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    syncInProgress = false;
    setTimeout(() => ind?.classList.add('hidden'), 2000);
    if (ui && btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-cloud-upload-alt mr-2"></i> Sync Now`; }
  }
}
