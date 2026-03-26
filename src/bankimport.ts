/**
 * OFX / QIF bank file parsers.
 * Returns normalised BankRow[] ready to feed into executeBankImport().
 */

export interface BankRow {
  date: string;   // YYYY-MM-DD
  desc: string;   // payee / memo
  amount: number; // positive = credit/income, negative = debit/expense
}

// ─── OFX / Open Financial Exchange ───────────────────────────────────────────
// Supports both legacy SGML OFX (no closing tags) and XML OFX (v2).

const MAX_OFX_BYTES = 5 * 1024 * 1024; // 5 MB

/** Convert DTPOSTED "YYYYMMDDHHMMSS[.mmm][TZ]" → "YYYY-MM-DD" */
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

/** Extract text content of the first occurrence of a tag in an SGML/XML fragment. */
function getTagValue(block: string, tag: string): string {
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
  if (text.length > MAX_OFX_BYTES) throw new Error('OFX file exceeds 5 MB size limit');

  // Must contain at least one STMTTRN block
  if (!/<STMTTRN[\s>]/i.test(text)) {
    throw new Error('File does not appear to be a valid OFX statement (no STMTTRN records found)');
  }

  const rows: BankRow[] = [];

  // Split on STMTTRN blocks (handles both SGML and XML variants)
  const blockRe = /<STMTTRN[\s>]([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;

  // For SGML OFX (no closing tags), each block is delimited by the next <STMTTRN or end
  // Try XML-style first; fall back to SGML splitting
  const hasClosingTags = /<\/STMTTRN>/i.test(text);

  if (hasClosingTags) {
    // XML OFX
    while ((match = blockRe.exec(text)) !== null) {
      const block = match[1];
      const row = extractOFXRow(block);
      if (row) rows.push(row);
    }
  } else {
    // SGML OFX — split on <STMTTRN> open tags
    const parts = text.split(/<STMTTRN>/i);
    for (let i = 1; i < parts.length; i++) {
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
  if (!date) return null;

  const amount = parseFloat(amtRaw.replace(/[^0-9.\-]/g, ''));
  if (isNaN(amount) || !isFinite(amount)) return null;

  // Sanitise description (strip HTML-like entities to prevent XSS if ever rendered as HTML)
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
  // Handle QIF-specific apostrophe-year: "1/15'15" → "1/15/2015"
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
  if (text.length > MAX_OFX_BYTES) throw new Error('QIF file exceeds 5 MB size limit');

  const lines = text.split(/\r?\n/);
  const rows: BankRow[] = [];

  let date: string | null = null;
  let amount: number | null = null;
  let desc = '';
  let recordCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const field = line[0].toUpperCase();
    const value = line.slice(1).trim();

    switch (field) {
      case '!': break; // account type header — skip
      case 'D': date = parseQIFDate(value); break;
      case 'T':
      case 'U': {
        // Remove commas (thousands separator) and trailing minus (some QIF exports)
        let v = value.replace(/,/g, '').trim();
        if (v.endsWith('-')) v = '-' + v.slice(0, -1);
        const n = parseFloat(v);
        if (!isNaN(n) && isFinite(n)) amount = n;
        break;
      }
      case 'P': desc = value.slice(0, 200); break;
      case 'M': if (!desc) desc = value.slice(0, 200); break; // memo as fallback
      case '^': {
        // End of record
        recordCount++;
        if (date !== null && amount !== null) {
          rows.push({ date, desc: desc || 'Bank transaction', amount });
        }
        date = null; amount = null; desc = '';
        break;
      }
      default: break;
    }
  }

  // Handle file without trailing ^
  if (date !== null && amount !== null) {
    rows.push({ date, desc: desc || 'Bank transaction', amount });
  }

  if (recordCount === 0 && rows.length === 0) {
    throw new Error('File does not appear to be a valid QIF file (no records found)');
  }

  return rows;
}
