/**
 * OFX / QIF bank file parsers.
 * Returns normalised BankRow[] ready to feed into executeBankImport().
 */

export interface BankRow {
  date: string;   // YYYY-MM-DD
  desc: string;   // payee / memo
  amount: number; // positive = credit/income, negative = debit/expense (never 0)
}

// ─── Shared limits ────────────────────────────────────────────────────────────
const MAX_BANK_FILE_BYTES = 5 * 1024 * 1024;  // 5 MB
const MAX_IMPORT_ROWS     = 10_000;             // DoS guard — no browser DoS
// Fix #2: cap amount to prevent 1e308/MAX_VALUE from entering the database
const MAX_IMPORT_AMOUNT   = 1_000_000_000;      // 1 billion — unreachably large for personal finance

// ─── OFX / Open Financial Exchange ───────────────────────────────────────────
// Supports both legacy SGML OFX (no closing tags) and XML OFX (v2).

/** Convert DTPOSTED "YYYYMMDDHHMMSS[.mmm][TZ]" → "YYYY-MM-DD"
 *  We deliberately extract the local date digits from the bank's timestamp and
 *  ignore any timezone offset, since OFX DTPOSTED represents the bank-posted date
 *  in the account's local context (not UTC).
 */
function parseDtPosted(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const moInt = parseInt(mo, 10);
  const dInt  = parseInt(d, 10);
  if (moInt < 1 || moInt > 12 || dInt < 1 || dInt > 31) return null;
  // Validate day-in-month
  if (new Date(parseInt(y, 10), moInt - 1, dInt).getDate() !== dInt) return null;
  return `${y}-${mo}-${d}`;
}

/** Extract text content of the first occurrence of a tag in an SGML/XML fragment.
 *  Tag names are validated to be safe alphanumeric strings before building regexes. */
function getTagValue(block: string, tag: string): string {
  // Safety: only allow known safe tag names (all-caps alphanumeric)
  if (!/^[A-Z0-9]+$/.test(tag)) return '';
  // XML: <TAG>value</TAG>
  const xmlRe = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const xmlM = block.match(xmlRe);
  if (xmlM) return xmlM[1].trim();
  // SGML: <TAG>value (no closing tag — value runs until next tag or newline)
  const sgmlRe = new RegExp(`<${tag}>([^<\r\n]*)`, 'i');
  const sgmlM = block.match(sgmlRe);
  if (sgmlM) return sgmlM[1].trim();
  return '';
}

/**
 * Parse OFX (SGML or XML) text into BankRow[].
 * Throws a descriptive error if the input doesn't look like OFX.
 */
export function parseOFX(text: string): BankRow[] {
  if (text.length > MAX_BANK_FILE_BYTES) throw new Error('OFX file exceeds 5 MB size limit');

  // Must contain at least one STMTTRN block
  if (!/<STMTTRN[\s>]/i.test(text)) {
    throw new Error('File does not appear to be a valid OFX statement (no STMTTRN records found)');
  }

  const rows: BankRow[] = [];

  // Fix #6: Limit total records to prevent client-side DoS
  const hasClosingTags = /<\/STMTTRN>/i.test(text);

  if (hasClosingTags) {
    // XML OFX — match each <STMTTRN>...</STMTTRN> block
    const blockRe = /<STMTTRN[\s>]([\s\S]*?)<\/STMTTRN>/gi;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(text)) !== null) {
      if (rows.length >= MAX_IMPORT_ROWS) break; // DoS guard
      const row = extractOFXRow(match[1]);
      if (row) rows.push(row);
    }
  } else {
    // SGML OFX — split on <STMTTRN> open tags
    const parts = text.split(/<STMTTRN>/i);
    for (let i = 1; i < parts.length && rows.length < MAX_IMPORT_ROWS; i++) {
      const row = extractOFXRow(parts[i]);
      if (row) rows.push(row);
    }
  }

  return rows;
}

function extractOFXRow(block: string): BankRow | null {
  const dtRaw  = getTagValue(block, 'DTPOSTED');
  const amtRaw = getTagValue(block, 'TRNAMT');
  const name   = getTagValue(block, 'NAME') || getTagValue(block, 'MEMO') || 'Bank transaction';

  const date = parseDtPosted(dtRaw);
  if (!date) return null; // Fix #8: skip records without a valid posting date

  // Fix #2: parse, validate finite, and cap to MAX_IMPORT_AMOUNT
  const rawAmt = parseFloat(amtRaw.replace(/[^0-9.\-]/g, ''));
  if (isNaN(rawAmt) || !isFinite(rawAmt)) return null;
  // Cap: if somehow 1e308 slipped through, reject rather than store garbage
  if (Math.abs(rawAmt) > MAX_IMPORT_AMOUNT) return null;
  // Fix #10: treat -0 as 0 (income of zero = skip)
  const amount = rawAmt === 0 ? null : rawAmt;
  if (amount === null) return null;

  // Sanitise description (decode OFX HTML entities; do NOT re-interpret as HTML)
  const desc = name
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim()
    .slice(0, 200);

  return { date, desc: desc || 'Bank transaction', amount };
}

// ─── QIF / Quicken Interchange Format ────────────────────────────────────────
// Fields: D = date, T = amount, P = payee, M = memo; ^ = record separator.

const QIF_DATE_FORMATS: Array<(parts: string[]) => string | null> = [
  // M/D/YYYY or M/D/YY (US format)
  (p) => {
    if (p.length < 3) return null;
    const y = p[2].length === 2 ? '20' + p[2] : p[2];
    const mo = p[0].padStart(2, '0');
    const d = p[1].padStart(2, '0');
    if (parseInt(mo, 10) > 12 || parseInt(d, 10) > 31) return null;
    return `${y}-${mo}-${d}`;
  },
  // D/M/YYYY or D/M/YY (EU format, fallback)
  (p) => {
    if (p.length < 3) return null;
    const y = p[2].length === 2 ? '20' + p[2] : p[2];
    const mo = p[1].padStart(2, '0');
    const d = p[0].padStart(2, '0');
    if (parseInt(mo, 10) > 12 || parseInt(d, 10) > 31) return null;
    return `${y}-${mo}-${d}`;
  },
];

function parseQIFDate(raw: string): string | null {
  // Normalise separators to /
  const normalised = raw.trim().replace(/[-.']/g, '/');
  const parts = normalised.split('/');

  // Try ISO first (YYYY-MM-DD)
  if (parts[0].length === 4) {
    const y = parts[0];
    const mo = (parts[1] ?? '').padStart(2, '0');
    const d = (parts[2] ?? '').padStart(2, '0');
    const moInt = parseInt(mo, 10);
    const dInt  = parseInt(d, 10);
    if (moInt >= 1 && moInt <= 12 && dInt >= 1 && dInt <= 31) {
      if (new Date(parseInt(y, 10), moInt - 1, dInt).getDate() === dInt) {
        return `${y}-${mo}-${d}`;
      }
    }
    return null;
  }

  for (const fmt of QIF_DATE_FORMATS) {
    const result = fmt(parts);
    if (result) {
      const [y, mo, d] = result.split('-').map(Number);
      if (new Date(y, mo - 1, d).getDate() === d) return result;
    }
  }
  return null;
}

/**
 * Parse QIF text into BankRow[].
 * Throws a descriptive error if the input doesn't contain valid QIF records.
 */
export function parseQIF(text: string): BankRow[] {
  if (text.length > MAX_BANK_FILE_BYTES) throw new Error('QIF file exceeds 5 MB size limit');

  const lines = text.split(/\r?\n/);
  const rows: BankRow[] = [];

  let date: string | null = null;
  let amount: number | null = null;  // Fix #7: set once from T field; U field does not overwrite
  let desc = '';
  let recordCount = 0;
  let amountFieldSeen = false; // Fix #7: first T wins, U is only fallback

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const field = line[0].toUpperCase();
    const value = line.slice(1).trim();

    switch (field) {
      case '!': break; // account type header — skip
      case 'D': date = parseQIFDate(value); break;
      case 'T': {
        if (amountFieldSeen) break; // Fix #7: T wins; ignore subsequent T/U in same record
        amountFieldSeen = true;
        let v = value.replace(/,/g, '').trim();
        if (v.endsWith('-')) v = '-' + v.slice(0, -1);
        const n = parseFloat(v);
        // Fix #2: reject NaN, Infinity, and unreasonably large values
        if (!isNaN(n) && isFinite(n) && Math.abs(n) <= MAX_IMPORT_AMOUNT && n !== 0) {
          // Fix: round to 2 decimal places to avoid floating-point noise
          amount = Math.round(n * 100) / 100;
        }
        break;
      }
      case 'U': {
        if (amountFieldSeen) break; // Fix #7: T wins; U is only used if T was absent
        amountFieldSeen = true;
        let v = value.replace(/,/g, '').trim();
        if (v.endsWith('-')) v = '-' + v.slice(0, -1);
        const n = parseFloat(v);
        if (!isNaN(n) && isFinite(n) && Math.abs(n) <= MAX_IMPORT_AMOUNT && n !== 0) {
          amount = Math.round(n * 100) / 100;
        }
        break;
      }
      case 'P': desc = value.slice(0, 200); break;
      case 'M': if (!desc) desc = value.slice(0, 200); break; // memo as fallback
      case '^': {
        recordCount++;
        if (date !== null && amount !== null && rows.length < MAX_IMPORT_ROWS) {
          rows.push({ date, desc: desc || 'Bank transaction', amount });
        }
        date = null; amount = null; desc = ''; amountFieldSeen = false;
        break;
      }
      default: break;
    }
  }

  // Handle file without trailing ^
  if (date !== null && amount !== null && rows.length < MAX_IMPORT_ROWS) {
    rows.push({ date, desc: desc || 'Bank transaction', amount });
  }

  if (recordCount === 0 && rows.length === 0) {
    throw new Error('File does not appear to be a valid QIF file (no records found)');
  }

  return rows;
}
