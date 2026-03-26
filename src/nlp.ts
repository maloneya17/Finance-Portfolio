/**
 * Phase 5G — Natural language transaction parser.
 * Converts freeform text like "Coffee £3.50 yesterday" into structured form data.
 * Pure client-side: no API calls, no network, no dependencies.
 */

export interface NLPResult {
  desc: string;
  amount: number | null;
  date: string | null;       // YYYY-MM-DD
  type: 'income' | 'expense' | null;
  category: string | null;
}

// ─── Category keyword inference ───────────────────────────────────────────────
// Pre-compiled at module load — one RegExp per category using word-boundary alternation.
// Prevents ReDoS (no per-call regex construction) and false-positive substring matches
// like "netflix" ⊇ "tfl".
//
// Word boundary: (?<![a-z]) / (?![a-z]) — works for multi-byte chars and avoids
// catastrophic backtracking caused by \b in Unicode-heavy inputs.

function _buildCatRe(words: string[]): RegExp {
  const alts = words
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`(?<![a-z])(${alts})(?![a-z])`, 'i');
}

const CAT_RULES: Array<{ re: RegExp; category: string }> = [
  { re: _buildCatRe(['rent', 'mortgage', 'landlord', 'housing', 'lease']), category: 'Housing' },
  { re: _buildCatRe(['coffee', 'cafe', 'lunch', 'dinner', 'food', 'grocery', 'groceries', 'supermarket', 'takeaway', 'restaurant', 'breakfast', 'tesco', 'sainsbury', 'waitrose', 'aldi', 'lidl', 'asda', 'morrisons', 'costco', 'meal', 'snack', 'pizza', 'burger', 'sushi']), category: 'Food' },
  { re: _buildCatRe(['uber', 'taxi', 'bus', 'train', 'tube', 'metro', 'petrol', 'fuel', 'car', 'parking', 'tfl', 'oyster', 'transport', 'flight', 'airline', 'rail', 'ferry', 'toll']), category: 'Transport' },
  { re: _buildCatRe(['electricity', 'gas', 'water', 'internet', 'broadband', 'phone', 'mobile', 'utility', 'utilities', 'bt', 'virgin', 'sky', 'boiler', 'heating']), category: 'Utilities' },
  { re: _buildCatRe(['netflix', 'spotify', 'disney', 'cinema', 'theatre', 'concert', 'gym', 'games', 'steam', 'playstation', 'xbox', 'entertainment', 'hobby', 'subscription', 'youtube']), category: 'Entertainment' },
  { re: _buildCatRe(['doctor', 'pharmacy', 'dentist', 'optician', 'hospital', 'medicine', 'health', 'nhs', 'gp', 'prescription', 'therapy', 'physio', 'chemist']), category: 'Health' },
  { re: _buildCatRe(['saving', 'savings', 'isa', 'pension', 'investment', 'invest', 'pot']), category: 'Savings' },
  { re: _buildCatRe(['credit card', 'loan', 'debt', 'repayment', 'overdraft']), category: 'Debt' },
];

// Income/expense type detection — word boundary regexes pre-compiled at load time
const INCOME_RE  = _buildCatRe(['salary', 'wage', 'payroll', 'income', 'earned', 'freelance', 'consulting', 'invoice', 'dividend', 'refund', 'cashback', 'reimbursement', 'hmrc', 'benefit', 'bonus', 'commission']);
const EXPENSE_RE = _buildCatRe(['paid', 'bought', 'spent', 'purchased', 'charged', 'bill', 'fee']);

// ─── Date word parsing ────────────────────────────────────────────────────────
function parseDateWord(word: string): string | null {
  const today = new Date();
  const y  = today.getFullYear();
  const m  = today.getMonth();  // 0-indexed
  const d  = today.getDate();

  const lw = word.toLowerCase();

  if (lw === 'today') return toISO(today);
  if (lw === 'yesterday') return toISO(new Date(y, m, d - 1));
  if (lw === 'tomorrow') return toISO(new Date(y, m, d + 1));

  // Day names: monday, tuesday, etc. — resolve to most recent past occurrence
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayIdx = dayNames.indexOf(lw);
  if (dayIdx !== -1) {
    const diff = (today.getDay() - dayIdx + 7) % 7 || 7; // 0 = today → use 7 (last week)
    return toISO(new Date(y, m, d - diff));
  }

  // "1st", "2nd", "3rd", "15th", "21st" etc.
  const ordM = lw.match(/^(\d{1,2})(st|nd|rd|th)$/);
  if (ordM) {
    const day = parseInt(ordM[1], 10);
    if (day >= 1 && day <= 31) {
      // Use current month; if day is in the future, use last month
      const candidate = new Date(y, m, day);
      if (candidate.getDate() === day) {
        return candidate > today
          ? toISO(new Date(y, m - 1, day))
          : toISO(candidate);
      }
    }
  }

  // "Jan 15", "15 Jan", "15/01", "01/15" etc.
  const MONTHS: Record<string, number> = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
    january:0,february:1,march:2,april:3,june:5,july:6,august:7,
    september:8,october:9,november:10,december:11
  };

  // "15 jan" or "jan 15"
  const mnM = lw.match(/^(\d{1,2})\s+([a-z]+)$/) ?? lw.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (mnM) {
    const [, a, b] = mnM;
    const numPart  = parseInt(a, 10);
    const strPart  = b.toLowerCase();
    const alphaFirst = isNaN(numPart);
    const day   = alphaFirst ? parseInt(b, 10) : numPart;
    const month = alphaFirst ? MONTHS[a.toLowerCase()] : MONTHS[strPart];
    if (day >= 1 && day <= 31 && month !== undefined) {
      const candidate = new Date(y, month, day);
      if (candidate.getDate() === day) return toISO(candidate);
    }
  }

  // "15/01" or "01/15"
  const slashM = lw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashM) {
    const a = parseInt(slashM[1], 10);
    const b = parseInt(slashM[2], 10);
    // Ambiguous: try DD/MM first (UK default), then MM/DD
    if (a >= 1 && a <= 31 && b >= 1 && b <= 12) {
      const candidate = new Date(y, b - 1, a);
      if (candidate.getDate() === a) return toISO(candidate);
    }
    if (b >= 1 && b <= 31 && a >= 1 && a <= 12) {
      const candidate = new Date(y, a - 1, b);
      if (candidate.getDate() === b) return toISO(candidate);
    }
  }

  return null;
}

function toISO(d: Date): string {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse natural language text into structured transaction fields.
 * Examples:
 *   "Coffee £3.50 yesterday"   → { desc: "Coffee", amount: 3.50, date: yesterday, type: expense }
 *   "Salary 2500 income"       → { desc: "Salary", amount: 2500, type: income }
 *   "Netflix 9.99 15th"        → { desc: "Netflix", amount: 9.99, date: 15th of current month }
 */
// Max input length — caps O(n) regex work to a safe bound
const MAX_NLP_INPUT = 500;

export function parseNL(text: string): NLPResult {
  const result: NLPResult = { desc: '', amount: null, date: null, type: null, category: null };
  const safe = text.trim().slice(0, MAX_NLP_INPUT);
  if (!safe) return result;
  // Shadow `text` with the capped version for all subsequent processing
  const _text = safe;

  // Tokenise: split on whitespace, keep punctuation attached to numbers
  const tokens = _text.split(/\s+/);
  const consumed = new Set<number>();

  // ── Amount detection ───────────────────────────────────────────────────────
  // Patterns: £3.50, $9.99, 3.50, 3,500.00, 1000
  const amtRe = /^[£$€]?([\d,]+(\.\d{1,2})?)$/;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/,/g, ''); // strip thousands separators
    const m = t.match(amtRe);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (isFinite(n) && n > 0 && n <= 1_000_000) {
        result.amount = n;
        consumed.add(i);
        break;
      }
    }
  }

  // ── Date detection ─────────────────────────────────────────────────────────
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const t = tokens[i];
    const date = parseDateWord(t);
    if (date) { result.date = date; consumed.add(i); break; }
    // Two-word date: "15 jan", "jan 15"
    if (i + 1 < tokens.length && !consumed.has(i + 1)) {
      const two = `${t} ${tokens[i + 1]}`;
      const d2  = parseDateWord(two);
      if (d2) { result.date = d2; consumed.add(i); consumed.add(i + 1); break; }
    }
  }

  // ── Type detection (pre-compiled regexes — no per-call construction) ────────
  const lower = _text.toLowerCase();
  if (INCOME_RE.test(lower))       result.type = 'income';
  else if (EXPENSE_RE.test(lower)) result.type = 'expense';

  // Mark explicit type keywords as consumed
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const t = tokens[i].toLowerCase();
    if (t === 'income' || t === 'expense' || t === 'credit' || t === 'debit') {
      if (t === 'income' || t === 'credit') result.type = result.type ?? 'income';
      if (t === 'expense' || t === 'debit') result.type = result.type ?? 'expense';
      consumed.add(i);
    }
  }

  // ── Category inference (pre-compiled regexes) ───────────────────────────────
  for (const { re, category } of CAT_RULES) {
    if (re.test(lower)) { result.category = category; break; }
  }

  // ── Description: remaining non-consumed tokens ────────────────────────────
  const descTokens = tokens.filter((_, i) => !consumed.has(i));
  result.desc = descTokens.join(' ').trim().slice(0, 200);

  // If no desc after stripping (e.g. user just typed "3.50"), use full text minus amount
  if (!result.desc && result.amount !== null) {
    result.desc = _text.replace(/[£$€]?\d[\d,.]*/, '').trim().slice(0, 200);
  }

  return result;
}
