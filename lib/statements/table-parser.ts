import { looksLikeDecimalAmount, parseAmount, parseStatementDate, startsWithDate } from "./parse-values";
import type { ParsedStatement, RawRow, TextItem } from "./types";

/**
 * Turns positioned text from a statement PDF into raw transaction rows.
 *
 * It does not guess financial meaning. It finds the table header, assigns every piece of text to a
 * column by position, joins multi-line narrations, works out debit vs credit, and reads the
 * statement's own opening/closing figures so the result can be checked later.
 */

export interface StatementParser {
  name: string;
  /** 0..1: how well this parser fits the document. */
  canParse(pages: TextItem[][]): number;
  parse(pages: TextItem[][], ctx: { ocr: boolean }): ParsedStatement;
}

/* ---------------- Lines ---------------- */

interface Line {
  page: number;
  y: number;
  items: TextItem[];
  text: string;
}

const right = (i: TextItem) => i.x + i.width;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function buildLines(pages: TextItem[][]): Line[] {
  const lines: Line[] = [];
  pages.forEach((items, p) => {
    const usable = items.filter((i) => i.str.trim() !== "");
    const tol = Math.max(2.5, median(usable.map((i) => i.height)) * 0.45);
    const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);
    let current: Line | null = null;
    for (const item of sorted) {
      if (current && Math.abs(current.y - item.y) <= tol) {
        current.items.push(item);
      } else {
        current = { page: p + 1, y: item.y, items: [item], text: "" };
        lines.push(current);
      }
    }
  });
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " ").trim();
  }
  return lines;
}

/* ---------------- Header detection ---------------- */

type Role = "date" | "valueDate" | "desc" | "ref" | "debit" | "credit" | "amount" | "balance";
const NUMERIC_ROLES: Role[] = ["debit", "credit", "amount", "balance"];

function roleOfHeader(cell: string): Role | null {
  const t = cell.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/value\s*(dt|date)|val\s*date/.test(t)) return "valueDate";
  if (/\b(balance|bal)\b/.test(t)) return "balance";
  if (/\b(withdrawal|withdrawals|debit|debits|paid out|money out|dr)\b/.test(t) || /^dr\b/.test(t)) return "debit";
  if (/\b(deposit|deposits|credit|credits|paid in|money in|cr)\b/.test(t) || /^cr\b/.test(t)) return "credit";
  if (/\bamount\b/.test(t) || t === "amt") return "amount";
  if (/\b(narration|description|particulars|details|remarks|transaction details|transaction remarks)\b/.test(t)) return "desc";
  if (/\b(chq|cheque|ref|reference|utr|instrument)\b/.test(t)) return "ref";
  if (/\bdate\b|^dt$|\btxn dt\b/.test(t)) return "date";
  return null;
}

interface Column {
  role: Role;
  left: number;
  right: number;
  text: string;
}

/** Merges neighbouring items of a header line into cells ("Withdrawal" + "Amt." -> one cell). */
function headerCells(items: TextItem[]): { text: string; left: number; right: number }[] {
  const cells: { text: string; left: number; right: number }[] = [];
  for (const item of items) {
    const last = cells[cells.length - 1];
    const gap = last ? item.x - last.right : Infinity;
    if (last && gap < Math.max(6, item.height * 0.9)) {
      last.text += " " + item.str.trim();
      last.right = right(item);
    } else {
      cells.push({ text: item.str.trim(), left: item.x, right: right(item) });
    }
  }
  return cells;
}

interface Header {
  lineIndex: number;
  columns: Column[];
}

function detectHeader(lines: Line[], from: number): Header | null {
  for (let i = from; i < lines.length; i++) {
    let cells = headerCells(lines[i].items);
    // A header cell can wrap onto the next line ("Withdrawal" / "Amt.").
    const next = lines[i + 1];
    if (next && next.page === lines[i].page && Math.abs(lines[i].y - next.y) < 16 && !startsWithDate(next.text)) {
      const nextCells = headerCells(next.items);
      const mergeable = nextCells.every((nc) => cells.some((c) => nc.left < c.right + 4 && nc.right > c.left - 4));
      if (mergeable && nextCells.length > 0 && nextCells.every((nc) => nc.text.length <= 14 && !parseAmount(nc.text))) {
        cells = cells.map((c) => {
          const extra = nextCells.filter((nc) => nc.left < c.right + 4 && nc.right > c.left - 4).map((nc) => nc.text);
          return extra.length ? { ...c, text: `${c.text} ${extra.join(" ")}` } : c;
        });
      }
    }
    const columns: Column[] = [];
    for (const cell of cells) {
      const role = roleOfHeader(cell.text);
      if (role && !columns.some((c) => c.role === role)) columns.push({ role, left: cell.left, right: cell.right, text: cell.text });
    }
    const roles = new Set(columns.map((c) => c.role));
    const hasMoney = roles.has("debit") || roles.has("credit") || roles.has("amount");
    if (roles.has("date") && hasMoney && columns.length >= 3) {
      columns.sort((a, b) => a.left - b.left);
      return { lineIndex: i, columns };
    }
  }
  return null;
}

/* ---------------- Statement-level facts ---------------- */

const BANKS: [RegExp, string][] = [
  [/hdfc/i, "HDFC Bank"], [/icici/i, "ICICI Bank"], [/state bank of india|\bsbi\b/i, "State Bank of India"],
  [/axis bank/i, "Axis Bank"], [/kotak|\bkkbk\d/i, "Kotak Mahindra Bank"], [/yes bank/i, "YES Bank"], [/idfc/i, "IDFC FIRST Bank"],
  [/punjab national|\bpnb\b/i, "Punjab National Bank"], [/bank of baroda/i, "Bank of Baroda"], [/canara/i, "Canara Bank"],
  [/indusind/i, "IndusInd Bank"], [/federal bank/i, "Federal Bank"], [/paytm payments/i, "Paytm Payments Bank"],
];

function signedBalance(text: string): number | undefined {
  const p = parseAmount(text);
  if (!p) return undefined;
  return p.sign === "debit" ? -p.minor : p.minor;
}

/** Money amounts printed on a line (decimals required, so counts and reference numbers are ignored). */
function amountsInText(text: string): number[] {
  return [...text.matchAll(/(?:₹|Rs\.?)?\s*\(?-?\d[\d,]*\.\d{2}\)?\s*(?:Cr|Dr|CR|DR)?/g)]
    .map((m) => signedBalance(m[0].replace(/\s+/g, "")))
    .filter((n): n is number => n !== undefined);
}

function readFacts(lines: Line[]): Pick<ParsedStatement, "openingBalanceMinor" | "closingBalanceMinor" | "periodStart" | "periodEnd" | "accountMask" | "bankHint"> {
  const facts: ReturnType<typeof readFacts> = {};
  // The bank's name is in the header block, above the first transaction. Narrations mention other banks.
  const firstTxn = lines.findIndex((l) => startsWithDate(l.text) && /\d[\d,]*\.\d{2}/.test(l.text));
  const head = lines.slice(0, firstTxn === -1 ? 25 : Math.min(firstTxn, 25)).map((l) => l.text).join(" ");
  facts.bankHint = BANKS.find(([re]) => re.test(head))?.[1];

  for (const line of lines) {
    const t = line.text;
    const lower = t.toLowerCase();

    if (!facts.accountMask) {
      const m = /(?:a\/c|account)\s*(?:no|number|#)?\.?\s*[:\-]?\s*([X*\d][X*\d ]{5,})/i.exec(t);
      if (m) {
        const digits = m[1].replace(/\D/g, "");
        if (digits.length >= 4) facts.accountMask = digits.slice(-4);
      }
    }

    if (!facts.periodStart && /(from|period|statement of account|between)/.test(lower)) {
      const dates = [...t.matchAll(/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[ -][A-Za-z]{3,9}[ -,]*\d{2,4}/g)]
        .map((m) => parseStatementDate(m[0]))
        .filter((d): d is string => !!d);
      if (dates.length >= 2) {
        facts.periodStart = dates[0];
        facts.periodEnd = dates[1];
      }
    }

    const hasOpen = /opening\s*bal|balance\s*(b\/f|brought forward|bf)|b\/f\s*bal/.test(lower);
    const hasClose = /closing\s*bal|balance\s*(c\/f|carried forward)/.test(lower);
    if (hasOpen && hasClose) {
      // A summary table: labels on this line, figures on the next.
      const next = lines[lines.indexOf(line) + 1];
      if (next) {
        const nums = amountsInText(next.text);
        if (nums.length >= 2) {
          facts.openingBalanceMinor ??= nums[0];
          facts.closingBalanceMinor ??= nums[nums.length - 1];
        }
      }
    } else if (hasOpen && facts.openingBalanceMinor === undefined) {
      const nums = amountsInText(t);
      if (nums.length) facts.openingBalanceMinor = nums[0];
    } else if (hasClose && facts.closingBalanceMinor === undefined) {
      const nums = amountsInText(t);
      if (nums.length) facts.closingBalanceMinor = nums[nums.length - 1];
    }
  }
  return facts;
}

const FOOTER = /^(opening|closing)\s*bal|^balance\s*(b\/f|c\/f|brought|carried)|page\s*\d+\s*(of|\/)\s*\d+|statement summary|generated (on|by)|this is a computer|registered office|^\*{2,}|end of statement|^total\b|^grand total|^sub total|not responsible|abbreviations|^legend/i;

/* ---------------- The table parser ---------------- */

interface Draft {
  page: number;
  /** Baseline of the first printed line, in PDF units from the page bottom. */
  y: number;
  lines: string[];
  dateText: string;
  valueDateText: string;
  desc: string[];
  ref: string[];
  debit?: string;
  credit?: string;
  amount?: string;
  balance?: string;
  extraAmounts: string[];
}

function newDraft(page: number, y: number): Draft {
  return { page, y, lines: [], dateText: "", valueDateText: "", desc: [], ref: [], extraAmounts: [] };
}

function assignItems(line: Line, columns: Column[]): Partial<Record<Role, string[]>> {
  const textCols = columns.filter((c) => !NUMERIC_ROLES.includes(c.role));
  const numCols = columns.filter((c) => NUMERIC_ROLES.includes(c.role));
  const firstNumLeft = numCols.length ? Math.min(...numCols.map((c) => c.left)) : Infinity;
  const out: Partial<Record<Role, string[]>> = {};
  const put = (role: Role, s: string) => (out[role] ??= []).push(s);

  for (const item of line.items) {
    const text = item.str.trim();
    if (!text) continue;
    const isAmountLike = parseAmount(text) !== null && (looksLikeDecimalAmount(text) || /^[\d,]+\.\d{1,2}\s*(Cr|Dr)?$/i.test(text));
    if (isAmountLike && numCols.length && right(item) >= firstNumLeft - 12) {
      // Numbers are right-aligned under their header: pick the column whose right edge is closest.
      let best = numCols[0];
      let bestD = Infinity;
      for (const c of numCols) {
        const d = Math.min(Math.abs(right(item) - c.right), Math.abs(item.x + item.width / 2 - (c.left + c.right) / 2), Math.abs(item.x - c.left));
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      put(best.role, text);
      continue;
    }
    // A serial-number column ("#", "Sr.") sits left of the first real column: not part of any field.
    if (textCols.length && right(item) < Math.min(...textCols.map((c) => c.left)) - 4) continue;
    // Text columns are left-aligned: the last column that starts at or before the item.
    let target = textCols[0];
    for (const c of textCols) if (item.x >= c.left - 6) target = c;
    if (target) put(target.role, text);
  }
  return out;
}

function amountOf(text?: string) {
  return text ? parseAmount(text) : null;
}

export const genericTableParser: StatementParser = {
  name: "GenericTableParser",

  canParse(pages) {
    const header = detectHeader(buildLines(pages), 0);
    return header ? 0.9 : 0;
  },

  parse(pages, ctx) {
    const lines = buildLines(pages);
    const facts = readFacts(lines);
    const warnings: string[] = [];
    const first = detectHeader(lines, 0);
    if (!first) return { parser: this.name, rows: [], warnings: ["No transaction table header found"], ocr: ctx.ocr, ...facts };

    let columns = first.columns;
    const drafts: Draft[] = [];
    let current: Draft | null = null;

    for (let i = first.lineIndex + 1; i < lines.length; i++) {
      const line = lines[i];

      // The header repeats on every page; use it to refresh column positions and skip it.
      const again = detectHeader([line, ...(lines[i + 1] ? [lines[i + 1]] : [])], 0);
      if (again && again.lineIndex === 0) {
        columns = again.columns;
        if (lines[i + 1] && Math.abs(line.y - lines[i + 1].y) < 16 && !startsWithDate(lines[i + 1].text)) i++;
        current = null;
        continue;
      }

      if (FOOTER.test(line.text)) {
        current = null;
        continue;
      }

      const cells = assignItems(line, columns);
      const dateText = (cells.date ?? []).join(" ").trim();
      const isNewRow = dateText !== "" && parseStatementDate(dateText) !== null;

      if (isNewRow) {
        current = newDraft(line.page, line.y);
        drafts.push(current);
        current.dateText = dateText;
      }
      if (!current) continue;

      current.lines.push(line.text);
      if (isNewRow || !(cells.date && cells.date.length)) {
        if (cells.valueDate) current.valueDateText ||= cells.valueDate.join(" ");
        if (cells.desc) current.desc.push(cells.desc.join(" "));
        if (cells.ref) current.ref.push(cells.ref.join(" "));
        // Numbers that landed in a text column when a line has none of the numeric columns: keep for diagnostics.
        for (const role of NUMERIC_ROLES) {
          const v = cells[role]?.join(" ");
          if (!v) continue;
          if (role === "date" || role === "valueDate" || role === "desc" || role === "ref") continue;
          if (!current[role]) current[role] = v;
          else current.extraAmounts.push(v);
        }
      }
    }

    const rows = finalize(drafts, columns, facts.openingBalanceMinor, warnings);
    return {
      parser: this.name,
      rows: rows.rows,
      warnings: [...warnings, ...rows.warnings],
      ocr: ctx.ocr,
      ...facts,
      openingBalanceMinor: facts.openingBalanceMinor ?? rows.derivedOpening,
      openingDerived: facts.openingBalanceMinor === undefined && rows.derivedOpening !== undefined,
    };
  },
};

/* ---------------- Headerless fallback ---------------- */

export const genericLineParser: StatementParser = {
  name: "GenericLineParser",

  canParse(pages) {
    const lines = buildLines(pages);
    const hits = lines.filter((l) => startsWithDate(l.text) && l.items.some((i) => looksLikeDecimalAmount(i.str))).length;
    return hits >= 3 ? 0.4 : 0;
  },

  parse(pages, ctx) {
    const lines = buildLines(pages);
    const facts = readFacts(lines);
    const drafts: Draft[] = [];
    let current: Draft | null = null;

    for (const line of lines) {
      if (FOOTER.test(line.text)) {
        current = null;
        continue;
      }
      const amountItems = line.items.filter((i) => looksLikeDecimalAmount(i.str) || /^[\d,]+\.\d{2}\s*(Cr|Dr)?$/i.test(i.str.trim()));
      // Date = the leading items that together parse as a date.
      let dateEnd = 0;
      let dateText = "";
      for (let n = 1; n <= Math.min(4, line.items.length); n++) {
        const candidate = line.items.slice(0, n).map((i) => i.str.trim()).join(" ");
        if (parseStatementDate(candidate)) {
          dateEnd = n;
          dateText = candidate;
        }
      }
      if (dateEnd > 0 && amountItems.length >= 1) {
        const d = newDraft(line.page, line.y);
        d.dateText = dateText;
        d.lines.push(line.text);
        const textItems = line.items.slice(dateEnd).filter((i) => !amountItems.includes(i));
        d.desc.push(textItems.map((i) => i.str.trim()).join(" "));
        const nums = amountItems.map((i) => i.str.trim());
        if (nums.length >= 2) {
          d.balance = nums[nums.length - 1];
          d.amount = nums[nums.length - 2];
        } else {
          d.amount = nums[0];
        }
        drafts.push(d);
        current = d;
      } else if (current && dateEnd === 0 && amountItems.length === 0) {
        current.desc.push(line.text);
        current.lines.push(line.text);
      } else {
        current = null;
      }
    }
    const columns: Column[] = [{ role: "amount", left: 0, right: 0, text: "" }, { role: "balance", left: 0, right: 0, text: "" }];
    const rows = finalize(drafts, columns, facts.openingBalanceMinor, []);
    return {
      parser: this.name,
      rows: rows.rows,
      warnings: ["No table header found; read lines by pattern (less reliable)", ...rows.warnings],
      ocr: ctx.ocr,
      ...facts,
      openingBalanceMinor: facts.openingBalanceMinor ?? rows.derivedOpening,
      openingDerived: facts.openingBalanceMinor === undefined && rows.derivedOpening !== undefined,
    };
  },
};

/* ---------------- Draft -> rows ---------------- */

function finalize(drafts: Draft[], columns: Column[], openingFact: number | undefined, warnings: string[]) {
  const hasDebitCredit = columns.some((c) => c.role === "debit") && columns.some((c) => c.role === "credit");

  interface Working extends RawRow {
    directionKnown: boolean;
    amountMinor: number;
  }
  const working: Working[] = [];

  for (const d of drafts) {
    const date = parseStatementDate(d.dateText);
    if (!date) continue;
    const rowWarnings: string[] = [];
    let confidence = 1;
    let debit = 0;
    let credit = 0;
    let directionKnown = true;
    let amountMinor = 0;

    if (hasDebitCredit) {
      const dr = amountOf(d.debit);
      const cr = amountOf(d.credit);
      debit = dr?.minor ?? 0;
      credit = cr?.minor ?? 0;
      amountMinor = debit || credit;
      if (debit && credit) {
        rowWarnings.push("Both debit and credit have amounts");
        confidence -= 0.3;
      }
      // A "Dr"/"Cr" in a plain Amount column is handled below; here a sign in the wrong column is a red flag.
    } else {
      const a = amountOf(d.amount ?? d.debit ?? d.credit);
      amountMinor = a?.minor ?? 0;
      if (a?.sign === "debit") debit = amountMinor;
      else if (a?.sign === "credit") credit = amountMinor;
      else if (d.credit && !d.debit && !d.amount) credit = amountMinor;
      else if (d.debit && !d.credit && !d.amount) debit = amountMinor;
      else directionKnown = false;
    }

    if (amountMinor === 0) {
      rowWarnings.push("No amount found on this line");
      confidence -= 0.5;
    }

    const balance = d.balance ? signedBalance(d.balance) : undefined;
    if (d.balance && balance === undefined) rowWarnings.push("Balance could not be read");

    const desc = d.desc.join(" ").replace(/\s+/g, " ").trim();
    if (!desc) {
      rowWarnings.push("Empty description");
      confidence -= 0.2;
    }
    const ref = d.ref.join(" ").replace(/\s+/g, " ").trim();

    working.push({
      index: 0,
      page: d.page,
      y: d.y,
      date,
      valueDate: d.valueDateText ? parseStatementDate(d.valueDateText) ?? undefined : undefined,
      rawDescription: desc,
      debitMinor: debit,
      creditMinor: credit,
      balanceMinor: balance,
      reference: ref || undefined,
      confidence: Math.max(0.1, confidence),
      rawLine: d.lines.join(" | "),
      warnings: rowWarnings,
      directionKnown,
      amountMinor,
    });
  }

  // Oldest first: some banks print newest first.
  const ordered = orderChronologically(working);

  // Work out direction from the running balance where the statement didn't say.
  let opening = openingFact;
  let derivedOpening: number | undefined;
  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i];
    if (r.directionKnown) continue;
    const prev = i > 0 ? ordered[i - 1].balanceMinor : opening;
    if (r.balanceMinor !== undefined && prev !== undefined) {
      const delta = r.balanceMinor - prev;
      if (delta === r.amountMinor) r.creditMinor = r.amountMinor;
      else if (delta === -r.amountMinor) r.debitMinor = r.amountMinor;
      else {
        r.debitMinor = r.amountMinor;
        r.warnings.push("Direction guessed: balance did not move by this amount");
        r.confidence = Math.min(r.confidence, 0.5);
      }
      r.directionKnown = true;
    } else {
      const hint = directionHint(r.rawDescription);
      if (hint === "credit") r.creditMinor = r.amountMinor;
      else r.debitMinor = r.amountMinor;
      r.warnings.push(
        hint
          ? `Direction inferred from the wording (${hint}); the statement didn't print an opening balance to confirm it`
          : "Direction could not be determined from the statement",
      );
      r.confidence = Math.min(r.confidence, hint ? 0.7 : 0.4);
    }
  }
  if (opening === undefined && ordered.length > 0 && ordered[0].balanceMinor !== undefined) {
    derivedOpening = ordered[0].balanceMinor - ordered[0].creditMinor + ordered[0].debitMinor;
  }

  ordered.forEach((r, i) => {
    r.index = i;
  });
  const rows: RawRow[] = ordered.map(({ directionKnown: _d, amountMinor: _a, ...rest }) => rest);
  if (rows.length === 0) warnings.push("No transaction rows were recognised");
  return { rows, warnings: [] as string[], derivedOpening };
}

/** Words that make the direction of a line obvious, for when the balance can't tell us. */
function directionHint(description: string): "debit" | "credit" | null {
  if (/CR|CREDIT|SALARY|INT\.?\s*PD|INTEREST|REFUND|REVERSAL|DEPOSIT|CASHBACK/i.test(description) && !/DEBIT/i.test(description)) return "credit";
  if (/DR|WDL|WITHDRAWAL|DEBIT|CHARGES|POS|ATM/i.test(description)) return "debit";
  return null;
}

/** How many consecutive rows have balances that follow from the amounts, in the given order. */
function continuity<T extends RawRow>(rows: T[]): number {
  let ok = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].balanceMinor;
    const b = rows[i].balanceMinor;
    if (a === undefined || b === undefined) continue;
    if (b === a + rows[i].creditMinor - rows[i].debitMinor) ok++;
  }
  return ok;
}

function orderChronologically<T extends RawRow>(rows: T[]): T[] {
  if (rows.length < 2) return rows;
  const firstDate = rows[0].date;
  const lastDate = rows[rows.length - 1].date;
  const reversed = [...rows].reverse();
  if (firstDate < lastDate) return rows;
  if (firstDate > lastDate) return reversed;
  // All on one day: trust whichever order keeps the balances consistent.
  return continuity(reversed) > continuity(rows) ? reversed : rows;
}

/* ---------------- Choosing a parser ---------------- */

export const PARSERS: StatementParser[] = [genericTableParser, genericLineParser];

/**
 * Runs the parsers that fit and keeps the best result: the one whose balances reconcile,
 * otherwise the one that found the most rows.
 */
export function parseStatementItems(pages: TextItem[][], ctx: { ocr: boolean }): ParsedStatement {
  const candidates = PARSERS.map((p) => ({ parser: p, fit: p.canParse(pages) }))
    .filter((c) => c.fit > 0)
    .sort((a, b) => b.fit - a.fit);

  let best: { result: ParsedStatement; score: number } | null = null;
  for (const { parser, fit } of candidates) {
    const result = parser.parse(pages, ctx);
    if (result.rows.length === 0) continue;
    const score = continuity(result.rows) * 10 + result.rows.length + fit;
    if (!best || score > best.score) best = { result, score };
  }
  if (best) return best.result;
  return {
    parser: "none",
    rows: [],
    warnings: ["This doesn't look like a bank statement we can read (no transaction table found)"],
    ocr: ctx.ocr,
  };
}
