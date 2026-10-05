/** Reading dates and money the way Indian bank statements print them. */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function build(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function fullYear(y: number): number {
  if (y >= 100) return y;
  return y <= 69 ? 2000 + y : 1900 + y;
}

/**
 * Parses a printed date into `YYYY-MM-DD`, or null if the text isn't a date.
 * Day-first (Indian) for numeric dates: 05/09/2026 is 5 September.
 * Accepts 05/09/2026, 05-09-26, 05.09.2026, 05 Sep 2026, 05-Sep-26, 5th Sep 2026, Sep 5, 2026, 2026-09-05.
 */
export function parseStatementDate(input: string): string | null {
  const s = input.trim().replace(/\s+/g, " ").replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) return build(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) return build(fullYear(+m[3]), +m[2], +m[1]);
  if ((m = /^(\d{1,2})[ -/.]?([A-Za-z]{3,9})[ -/.,]*(\d{2}|\d{4})$/.exec(s))) {
    const month = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    return month ? build(fullYear(+m[3]), month, +m[1]) : null;
  }
  if ((m = /^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})$/.exec(s))) {
    const month = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    return month ? build(+m[3], month, +m[2]) : null;
  }
  return null;
}

/** Does this text start with something that reads as a date? (Used to spot the first line of a transaction.) */
export function startsWithDate(text: string): boolean {
  const t = text.trim();
  return (
    /^\d{1,2}[-/.]\d{1,2}[-/.](\d{2}|\d{4})\b/.test(t) ||
    /^\d{4}-\d{2}-\d{2}\b/.test(t) ||
    /^\d{1,2}(st|nd|rd|th)?[ -]?[A-Za-z]{3,9}[ -,]*\d{2,4}\b/.test(t)
  );
}

export interface ParsedAmount {
  /** Always >= 0. */
  minor: number;
  /** Explicit direction printed with the number (Dr/Cr suffix, minus sign, brackets). */
  sign: "debit" | "credit" | null;
}

const AMOUNT = /^(?:₹|Rs\.?|INR)?\s*(\(|-|\+)?\s*(?:₹|Rs\.?|INR)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(\))?\s*(Cr|Dr|CR|DR|cr|dr)?\.?$/;

/**
 * Parses "1,23,456.78", "₹500", "(500.00)", "500.00 Dr", "-500". Returns null when it isn't an amount.
 */
export function parseAmount(input: string): ParsedAmount | null {
  const s = input.trim();
  if (!s) return null;
  const m = AMOUNT.exec(s);
  if (!m) return null;
  const rupees = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(rupees)) return null;
  const minor = Math.round(rupees * 100);
  let sign: ParsedAmount["sign"] = null;
  if (m[4]) sign = m[4].toLowerCase() === "dr" ? "debit" : "credit";
  else if (m[1] === "-" || (m[1] === "(" && m[3] === ")")) sign = "debit";
  return { minor, sign };
}

/** True for strings that look like money with a decimal part (safe to treat as an amount in free text). */
export function looksLikeDecimalAmount(input: string): boolean {
  return /^(?:₹|Rs\.?)?\s*[(-]?\d[\d,]*\.\d{2}\)?\s*(Cr|Dr|CR|DR)?$/.test(input.trim());
}
