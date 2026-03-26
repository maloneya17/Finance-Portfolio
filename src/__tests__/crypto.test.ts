/**
 * Exhaustive tests for src/crypto.ts
 * Tests AES-256-GCM encryption/decryption, round-trips, tampering detection,
 * and pathological inputs.
 */
import { describe, it, expect } from 'vitest';
import { encryptData, decryptData, isEncryptedEnvelope } from '../crypto';

// ─── Round-trip tests ─────────────────────────────────────────────────────────
describe('encryptData / decryptData round-trip', () => {
  const passphrase = 'correct-horse-battery-staple';

  it('encrypts and decrypts "hello world"', async () => {
    const enc = await encryptData('hello world', passphrase);
    const dec = await decryptData(enc, passphrase);
    expect(dec).toBe('hello world');
  });

  it('round-trips empty string', async () => {
    const enc = await encryptData('', passphrase);
    expect(await decryptData(enc, passphrase)).toBe('');
  });

  it('round-trips unicode', async () => {
    const input = '€ £ ¥ 日本語 emoji: 🔐';
    expect(await decryptData(await encryptData(input, passphrase), passphrase)).toBe(input);
  });

  it('round-trips JSON payload', async () => {
    const payload = JSON.stringify({ transactions: { '2025-03': [{ id: 'abc', amount: 99.99 }] } });
    expect(await decryptData(await encryptData(payload, passphrase), passphrase)).toBe(payload);
  });

  it('round-trips 100KB payload', async () => {
    const big = 'x'.repeat(100_000);
    expect(await decryptData(await encryptData(big, passphrase), passphrase)).toBe(big);
  });

  it('produces different ciphertext each time (fresh IV/salt)', async () => {
    const a = await encryptData('same', passphrase);
    const b = await encryptData('same', passphrase);
    expect(a).not.toBe(b);
  });

  it('output is valid JSON', async () => {
    const enc = await encryptData('test', passphrase);
    expect(() => JSON.parse(enc)).not.toThrow();
  });

  it('envelope has v:1 and enc field', async () => {
    const enc = JSON.parse(await encryptData('test', passphrase));
    expect(enc.v).toBe(1);
    expect(typeof enc.enc).toBe('string');
    expect(enc.enc.length).toBeGreaterThan(0);
  });
});

// ─── Wrong passphrase ─────────────────────────────────────────────────────────
describe('wrong passphrase', () => {
  it('throws on wrong passphrase', async () => {
    const enc = await encryptData('secret', 'good-pass');
    await expect(decryptData(enc, 'wrong-pass')).rejects.toThrow('Decryption failed');
  });

  it('throws on empty passphrase when encrypted with non-empty', async () => {
    const enc = await encryptData('secret', 'my-pass');
    await expect(decryptData(enc, '')).rejects.toThrow();
  });

  it('empty passphrase round-trips', async () => {
    const enc = await encryptData('data', '');
    expect(await decryptData(enc, '')).toBe('data');
  });
});

// ─── Tampered ciphertext ──────────────────────────────────────────────────────
describe('tampered ciphertext', () => {
  it('detects bit-flip in ciphertext', async () => {
    const enc = JSON.parse(await encryptData('sensitive data', 'pass'));
    const raw = atob(enc.enc);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    // Flip a byte in the ciphertext portion (after 28-byte salt+iv)
    bytes[30] ^= 0xff;
    const tampered = JSON.stringify({ v: 1, enc: btoa(String.fromCharCode(...bytes)) });
    await expect(decryptData(tampered, 'pass')).rejects.toThrow();
  });
});

// ─── Pathological inputs ──────────────────────────────────────────────────────
describe('decryptData pathological inputs', () => {
  it('throws on plain string', async () =>
    await expect(decryptData('not json', 'pass')).rejects.toThrow());

  it('throws on empty string', async () =>
    await expect(decryptData('', 'pass')).rejects.toThrow());

  it('throws on wrong version', async () =>
    await expect(decryptData('{"v":2,"enc":"abc"}', 'pass')).rejects.toThrow('Unsupported encryption version'));

  it('throws on missing enc field', async () =>
    await expect(decryptData('{"v":1}', 'pass')).rejects.toThrow());

  it('throws on empty enc field', async () =>
    await expect(decryptData('{"v":1,"enc":""}', 'pass')).rejects.toThrow());

  it('throws on truncated enc (less than salt+IV)', async () => {
    // Only 5 bytes encoded — less than the 28-byte minimum (salt 16 + IV 12)
    const short = btoa('short');
    await expect(decryptData(JSON.stringify({ v: 1, enc: short }), 'pass')).rejects.toThrow();
  });

  it('throws on invalid base64', async () =>
    await expect(decryptData('{"v":1,"enc":"!!!invalid_base64!!!"}', 'pass')).rejects.toThrow());

  it('throws on null JSON value', async () =>
    await expect(decryptData('null', 'pass')).rejects.toThrow());

  it('throws on array', async () =>
    await expect(decryptData('[]', 'pass')).rejects.toThrow());
});

// ─── isEncryptedEnvelope() ────────────────────────────────────────────────────
describe('isEncryptedEnvelope()', () => {
  it('recognises valid envelope', async () => {
    const enc = await encryptData('x', 'y');
    expect(isEncryptedEnvelope(enc)).toBe(true);
  });
  it('rejects plain JSON', () => expect(isEncryptedEnvelope('{"foo":"bar"}')).toBe(false));
  it('rejects plain string', () => expect(isEncryptedEnvelope('hello')).toBe(false));
  it('rejects empty string', () => expect(isEncryptedEnvelope('')).toBe(false));
  it('rejects v:2', () => expect(isEncryptedEnvelope('{"v":2,"enc":"abc"}')).toBe(false));
  it('rejects no enc field', () => expect(isEncryptedEnvelope('{"v":1}')).toBe(false));
  it('rejects enc:null', () => expect(isEncryptedEnvelope('{"v":1,"enc":null}')).toBe(false));
});
