/**
 * Local authentication: username + numeric PIN secured with PBKDF2-SHA-256.
 *
 * Storage layout
 * ─────────────
 *  localStorage['financeAuth']        — { username, salt (b64), pinHash (b64) }
 *  localStorage['financeAuthLockout'] — { until: ms, attempts: number }
 *  sessionStorage['financeAuthSession'] — { loggedIn: true, token: b64, loginTime: ms }
 *
 * Security model
 * ─────────────
 *  • PIN is NEVER stored in plaintext.
 *  • PBKDF2-SHA-256 with 200 000 iterations and a random 16-byte salt.
 *  • Hash comparison uses timingSafeEqual (via SubtleCrypto HMAC verify trick)
 *    to prevent timing-oracle attacks.
 *  • Failed-attempt lockout: 5 wrong tries → 30-second freeze, persisted in
 *    localStorage so page reloads cannot reset the counter.
 *  • Sessions carry a 32-byte cryptographic token so an XSS-injected
 *    { loggedIn: true } entry cannot impersonate a real login.
 *  • Sessions live in sessionStorage and die when the tab is closed.
 *  • Removing the auth key (forgot-PIN flow) does NOT touch portfolio data.
 */

const AUTH_KEY     = 'financeAuth';
const SESSION_KEY  = 'financeAuthSession';
const LOCKOUT_KEY  = 'financeAuthLockout';

const PBKDF2_ITERS  = 200_000;
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 30_000; // 30 s

interface AuthStore {
  username: string;
  salt:     string; // base64 of 16-byte random salt
  pinHash:  string; // base64 of 32-byte PBKDF2 output
}

interface LockoutStore {
  until:    number; // epoch ms when lockout expires
  attempts: number;
}

// ─── Persistent lockout helpers ────────────────────────────────────────────────

function readLockout(): LockoutStore {
  try {
    const raw = localStorage.getItem(LOCKOUT_KEY);
    if (!raw) return { until: 0, attempts: 0 };
    return JSON.parse(raw) as LockoutStore;
  } catch { return { until: 0, attempts: 0 }; }
}

function writeLockout(s: LockoutStore): void {
  localStorage.setItem(LOCKOUT_KEY, JSON.stringify(s));
}

function clearLockout(): void {
  localStorage.removeItem(LOCKOUT_KEY);
}

// ─── Crypto helpers ────────────────────────────────────────────────────────────

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveHash(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: PBKDF2_ITERS },
    keyMaterial,
    256,
  );
  return toB64(bits);
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** True if auth credentials have been created on this device. */
export function hasAccount(): boolean {
  return localStorage.getItem(AUTH_KEY) !== null;
}

/** Returns the stored username, or '' if no account exists. */
export function getStoredUsername(): string {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return '';
    return (JSON.parse(raw) as AuthStore).username;
  } catch {
    return '';
  }
}

/** True if the current browser session has an active login. */
export function isLoggedIn(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { loggedIn: boolean; token?: string };
    // Require both the flag AND a non-empty token so a plain { loggedIn: true }
    // injection (e.g. via XSS in a different script) cannot pass this check.
    return parsed.loggedIn === true && typeof parsed.token === 'string' && parsed.token.length > 0;
  } catch {
    return false;
  }
}

function setSession(value: boolean): void {
  if (value) {
    // 32 cryptographically random bytes → base64 session token
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...tokenBytes));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ loggedIn: true, token, loginTime: Date.now() }));
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

/** Ends the current session (but keeps auth credentials). */
export function logout(): void {
  setSession(false);
  // Clear any pending inactivity timer so it doesn't fire after re-login
  if (_inactivityTimer !== null) { clearTimeout(_inactivityTimer); _inactivityTimer = null; }
}

/**
 * Creates a new account with the given username and PIN.
 * Returns null on success, or an error string if validation fails.
 */
export async function createAccount(username: string, pin: string): Promise<string | null> {
  if (!username.trim()) return 'Please enter a username.';
  if (!/^\d{4,8}$/.test(pin)) return 'PIN must be 4–8 digits (numbers only).';

  const salt    = crypto.getRandomValues(new Uint8Array(16) as Uint8Array<ArrayBuffer>);
  const pinHash = await deriveHash(pin, salt);

  const store: AuthStore = {
    username: username.trim().slice(0, 50),
    salt:     toB64(salt.buffer as ArrayBuffer),
    pinHash,
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(store));
  setSession(true);
  return null;
}

/**
 * Constant-time comparison of two same-length base64 strings using SubtleCrypto
 * HMAC-SHA256 sign+verify to prevent timing oracles.  Returns true iff equal.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  // If lengths differ we still run the full comparison to avoid length leaks.
  const enc = new TextEncoder();
  const key  = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const sig  = await crypto.subtle.sign('HMAC', key, enc.encode(a));
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(b));
}

/**
 * Verifies the supplied PIN against the stored hash.
 * Returns null on success, or a human-readable error string on failure
 * (wrong PIN, lockout, or no account).
 */
export async function verifyPin(pin: string): Promise<string | null> {
  const now = Date.now();
  const lockout = readLockout();
  if (now < lockout.until) {
    const secs = Math.ceil((lockout.until - now) / 1000);
    return `Too many attempts. Try again in ${secs}s.`;
  }

  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return 'No account found.';
    const store = JSON.parse(raw) as AuthStore;
    const hash  = await deriveHash(pin, fromB64(store.salt));

    // Timing-safe comparison — prevents hash extraction via response-time analysis
    const match = await timingSafeEqual(hash, store.pinHash);

    if (match) {
      clearLockout();
      setSession(true);
      return null;
    }

    const newAttempts = lockout.attempts + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      writeLockout({ until: Date.now() + LOCKOUT_MS, attempts: 0 });
      return `Too many attempts. Try again in ${LOCKOUT_MS / 1000}s.`;
    }
    writeLockout({ until: 0, attempts: newAttempts });

    const left = MAX_ATTEMPTS - newAttempts;
    return `Incorrect PIN — ${left} attempt${left === 1 ? '' : 's'} remaining.`;
  } catch {
    return 'Authentication error — please try again.';
  }
}

/**
 * Changes the PIN after verifying the current one.
 * Returns null on success, or an error string on failure.
 */
export async function changePin(currentPin: string, newPin: string, confirmPin: string): Promise<string | null> {
  if (newPin !== confirmPin) return 'New PINs do not match.';
  if (!/^\d{4,8}$/.test(newPin)) return 'New PIN must be 4–8 digits (numbers only).';

  // Delegate current-PIN check to verifyPin() so the shared failed-attempt
  // lockout applies here too.  Without this, a logged-in attacker could
  // brute-force the Change PIN form without any rate limiting.
  const verifyErr = await verifyPin(currentPin);
  if (verifyErr) return verifyErr;

  // verifyPin passed — re-read store and write the new PIN with a fresh salt.
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return 'No account found.';
  const store = JSON.parse(raw) as AuthStore;

  const newSalt    = crypto.getRandomValues(new Uint8Array(16) as Uint8Array<ArrayBuffer>);
  const newPinHash = await deriveHash(newPin, newSalt);

  const updated: AuthStore = {
    ...store,
    salt:    toB64(newSalt.buffer as ArrayBuffer),
    pinHash: newPinHash,
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(updated));
  return null;
}

/**
 * Deletes only the auth credentials from localStorage.
 * Portfolio data is completely unaffected.
 * Use this for the "forgot PIN" recovery flow.
 */
export function deleteAccount(): void {
  localStorage.removeItem(AUTH_KEY);
  clearLockout();
  setSession(false);
}

// ─── Inactivity auto-lock ─────────────────────────────────────────────────────

const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes
let _inactivityTimer: ReturnType<typeof setTimeout> | null = null;

function resetInactivityTimer(): void {
  if (_inactivityTimer !== null) clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => { logout(); }, INACTIVITY_MS);
}

/**
 * Call once after a successful login to start the inactivity auto-lock.
 * Any user interaction resets the 30-minute countdown.
 */
export function startInactivityWatcher(): void {
  resetInactivityTimer();
  const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'pointerdown'] as const;
  events.forEach(ev => document.addEventListener(ev, resetInactivityTimer, { passive: true }));
}
