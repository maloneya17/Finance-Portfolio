/**
 * Tests for the natural language parser (src/nlp.ts).
 * Pure unit tests — no DOM, no network, no db.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseNL } from '../nlp';

// Fix "today" to a known date for deterministic date tests
const FIXED_DATE = new Date('2025-07-15'); // Tuesday
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_DATE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseNL — basic', () => {
  it('returns empty result for blank input', () => {
    const r = parseNL('');
    expect(r.desc).toBe('');
    expect(r.amount).toBeNull();
    expect(r.date).toBeNull();
    expect(r.type).toBeNull();
    expect(r.category).toBeNull();
  });

  it('parses amount with £ prefix', () => {
    const r = parseNL('Coffee £3.50');
    expect(r.amount).toBe(3.5);
    expect(r.desc).toBe('Coffee');
  });

  it('parses amount with $ prefix', () => {
    const r = parseNL('Lunch $12.99');
    expect(r.amount).toBe(12.99);
  });

  it('parses bare number as amount', () => {
    const r = parseNL('Groceries 45');
    expect(r.amount).toBe(45);
  });

  it('parses amounts with thousands separator', () => {
    const r = parseNL('Rent 1,200.00');
    expect(r.amount).toBe(1200);
  });

  it('rejects zero amount', () => {
    const r = parseNL('Coffee 0');
    expect(r.amount).toBeNull();
  });

  it('rejects negative amount', () => {
    const r = parseNL('Coffee £-5');
    expect(r.amount).toBeNull();
  });

  it('rejects amount over 1,000,000', () => {
    const r = parseNL('huge 1000001');
    expect(r.amount).toBeNull();
  });

  it('uses full text as desc when no amount', () => {
    const r = parseNL('Netflix');
    expect(r.desc).toBe('Netflix');
  });
});

describe('parseNL — dates', () => {
  it('resolves "today"', () => {
    const r = parseNL('Coffee 5 today');
    expect(r.date).toBe('2025-07-15');
  });

  it('resolves "yesterday"', () => {
    const r = parseNL('Coffee 5 yesterday');
    expect(r.date).toBe('2025-07-14');
  });

  it('resolves "tomorrow"', () => {
    const r = parseNL('Coffee 5 tomorrow');
    expect(r.date).toBe('2025-07-16');
  });

  it('resolves day name (monday = most recent past Monday)', () => {
    // Fixed date is Tuesday 2025-07-15; most recent Monday = 2025-07-14
    const r = parseNL('Coffee 5 monday');
    expect(r.date).toBe('2025-07-14');
  });

  it('resolves "saturday" to last Saturday', () => {
    // most recent Saturday before Tue 2025-07-15 = 2025-07-12
    const r = parseNL('Coffee 5 saturday');
    expect(r.date).toBe('2025-07-12');
  });

  it('resolves ordinal date "15th"', () => {
    const r = parseNL('Coffee 5 15th');
    expect(r.date).toBe('2025-07-15');
  });

  it('resolves future ordinal to previous month', () => {
    // "20th" — 20 > 15 (today), so should resolve to 2025-06-20
    const r = parseNL('Coffee 5 20th');
    expect(r.date).toBe('2025-06-20');
  });

  it('resolves "15/07" (DD/MM) format', () => {
    const r = parseNL('Coffee 5 15/07');
    expect(r.date).toBe('2025-07-15');
  });

  it('parses two-word date "jan 15"', () => {
    const r = parseNL('Coffee 5 jan 15');
    expect(r.date).toBe('2025-01-15');
  });

  it('parses two-word date "15 jan"', () => {
    const r = parseNL('Coffee 5 15 jan');
    expect(r.date).toBe('2025-01-15');
  });
});

describe('parseNL — type detection', () => {
  it('detects income from "salary" keyword', () => {
    const r = parseNL('salary 2500');
    expect(r.type).toBe('income');
  });

  it('detects income from "income" token', () => {
    const r = parseNL('Freelance 500 income');
    expect(r.type).toBe('income');
  });

  it('detects income from "credit" token', () => {
    const r = parseNL('Transfer 200 credit');
    expect(r.type).toBe('income');
  });

  it('detects expense from "expense" token', () => {
    const r = parseNL('Dinner 45 expense');
    expect(r.type).toBe('expense');
  });

  it('detects expense from "paid" keyword', () => {
    const r = parseNL('paid rent 800');
    expect(r.type).toBe('expense');
  });

  it('detects expense from "debit" token', () => {
    const r = parseNL('Amazon 29.99 debit');
    expect(r.type).toBe('expense');
  });

  it('income keywords take priority over expense keywords', () => {
    // "refund" is income; "paid" is expense — income wins first
    const r = parseNL('refund paid 50');
    expect(r.type).toBe('income');
  });

  it('returns null type for neutral text', () => {
    const r = parseNL('Something 10');
    expect(r.type).toBeNull();
  });
});

describe('parseNL — category inference', () => {
  it('infers Food from "coffee"', () => {
    expect(parseNL('coffee 3.50').category).toBe('Food');
  });

  it('infers Food from "grocery"', () => {
    expect(parseNL('grocery shop 45').category).toBe('Food');
  });

  it('infers Transport from "uber"', () => {
    expect(parseNL('uber 12').category).toBe('Transport');
  });

  it('infers Housing from "rent"', () => {
    expect(parseNL('rent 1200').category).toBe('Housing');
  });

  it('infers Utilities from "electricity"', () => {
    expect(parseNL('electricity bill 80').category).toBe('Utilities');
  });

  it('infers Entertainment from "netflix"', () => {
    expect(parseNL('netflix 9.99').category).toBe('Entertainment');
  });

  it('infers Health from "pharmacy"', () => {
    expect(parseNL('pharmacy 15').category).toBe('Health');
  });

  it('infers Savings from "savings"', () => {
    expect(parseNL('savings 200').category).toBe('Savings');
  });

  it('infers Debt from "loan"', () => {
    expect(parseNL('loan repayment 150').category).toBe('Debt');
  });

  it('returns null category for unknown text', () => {
    expect(parseNL('xyzabc 10').category).toBeNull();
  });
});

describe('parseNL — description assembly', () => {
  it('strips amount and date tokens from description', () => {
    const r = parseNL('Coffee £3.50 yesterday');
    expect(r.desc).toBe('Coffee');
    expect(r.amount).toBe(3.5);
    expect(r.date).toBe('2025-07-14');
  });

  it('strips type keyword from description', () => {
    const r = parseNL('Freelance 500 income');
    expect(r.desc).toBe('Freelance');
    expect(r.type).toBe('income');
  });

  it('uses full input when no amount and no tokens consumed', () => {
    const r = parseNL('Netflix subscription');
    expect(r.desc).toBe('Netflix subscription');
  });

  it('limits description to 200 chars', () => {
    const long = 'x'.repeat(250);
    const r = parseNL(long);
    expect(r.desc.length).toBeLessThanOrEqual(200);
  });
});

describe('parseNL — adversarial / edge cases', () => {
  it('handles only whitespace', () => {
    const r = parseNL('   ');
    expect(r.desc).toBe('');
    expect(r.amount).toBeNull();
  });

  it('handles multiple numbers — uses first valid one as amount', () => {
    const r = parseNL('2 coffees 7.00');
    expect(r.amount).toBe(2); // first number wins
  });

  it('does not interpret HTML tag as amount', () => {
    // NLP doesn't sanitize HTML — that's the render layer's job (esc())
    // But it should correctly parse the numeric amount
    const r = parseNL('<script> 5');
    expect(r.amount).toBe(5);
  });

  it('handles unicode normalisation — category still inferred', () => {
    // Full-width 'ｃｏｆｆｅｅ' should not match (NFC doesn't normalise full-width)
    const r = parseNL('ｃｏｆｆｅｅ 3.50');
    expect(r.category).toBeNull(); // correct — NLP doesn't collapse full-width
  });

  it('handles emoji in description', () => {
    const r = parseNL('🍕 pizza 12.00');
    expect(r.amount).toBe(12);
  });

  it('does not crash on very long input', () => {
    const long = 'coffee '.repeat(200) + '5';
    expect(() => parseNL(long)).not.toThrow();
  });

  it('parses £ with no space before amount', () => {
    const r = parseNL('Netflix £9.99 monthly');
    expect(r.amount).toBe(9.99);
  });
});
