/**
 * End-to-end encryption helpers using the Web Crypto API.
 * AES-256-GCM with PBKDF2-SHA-256 key derivation (200 000 iterations).
 *
 * Wire format (base64-encoded, packed):
 *   [ 16 bytes salt | 12 bytes IV | N bytes ciphertext+GCM-tag ]
 *
 * Outer JSON envelope: { "v": 1, "enc": "<base64>" }
 */

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES        = 16;
const IV_BYTES          = 12;

/** Allocate a fresh Uint8Array<ArrayBuffer> to satisfy strict Web Crypto typings. */
function newBytes(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(n) as Uint8Array<ArrayBuffer>;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/** Decode a base64 string into a typed Uint8Array<ArrayBuffer>. */
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = newBytes(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Encrypts a plaintext string with the given passphrase.
 * Returns a JSON string: { "v": 1, "enc": "<base64(salt+iv+ciphertext)>" }
 */
export async function encryptData(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(newBytes(SALT_BYTES));
  const iv   = crypto.getRandomValues(newBytes(IV_BYTES));
  const key  = await deriveKey(passphrase, salt);

  const enc       = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));

  // Pack: salt ‖ iv ‖ ciphertext+tag
  const packed = newBytes(SALT_BYTES + IV_BYTES + cipherBuf.byteLength);
  packed.set(salt, 0);
  packed.set(iv, SALT_BYTES);
  packed.set(new Uint8Array(cipherBuf), SALT_BYTES + IV_BYTES);

  return JSON.stringify({ v: 1, enc: toBase64(packed.buffer as ArrayBuffer) });
}

/**
 * Decrypts a string produced by encryptData().
 * Throws if the passphrase is wrong or the data is tampered (GCM auth failure).
 */
export async function decryptData(cipherJSON: string, passphrase: string): Promise<string> {
  let envelope: { v: number; enc: string };
  try {
    envelope = JSON.parse(cipherJSON) as { v: number; enc: string };
  } catch {
    throw new Error('Invalid encrypted payload');
  }
  if (envelope.v !== 1 || typeof envelope.enc !== 'string') {
    throw new Error('Unsupported encryption version');
  }

  const packed = fromBase64(envelope.enc);
  const salt   = newBytes(SALT_BYTES);
  const iv     = newBytes(IV_BYTES);
  salt.set(packed.slice(0, SALT_BYTES));
  iv.set(packed.slice(SALT_BYTES, SALT_BYTES + IV_BYTES));
  const cipher = packed.slice(SALT_BYTES + IV_BYTES);

  const key = await deriveKey(passphrase, salt);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  } catch {
    throw new Error('Decryption failed — wrong passphrase or corrupted data');
  }

  return new TextDecoder().decode(plainBuf);
}

/** Returns true if the string looks like an encrypted envelope produced by encryptData(). */
export function isEncryptedEnvelope(s: string): boolean {
  try {
    const obj = JSON.parse(s) as Record<string, unknown>;
    return obj.v === 1 && typeof obj.enc === 'string';
  } catch {
    return false;
  }
}
