import { StatementError, type TextItem } from "./types";

/**
 * Statements that aren't PDFs. Spreadsheet-style files (CSV, TSV, Excel) are turned into the same
 * positioned-text form a PDF page gives us, so every layout rule and check applies to them unchanged.
 */

export type StatementFormat = "pdf" | "xlsx" | "xls" | "csv" | "image" | "unknown";

export const ACCEPTED_EXTENSIONS = ".pdf,.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.png,.jpg,.jpeg,.webp";

const startsWith = (data: Uint8Array, sig: number[]) => sig.every((b, i) => data[i] === b);

/** Decides by content first (people rename files), then by name. */
export function detectFormat(data: Uint8Array, filename: string): StatementFormat {
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47]) || startsWith(data, [0xff, 0xd8, 0xff])) return "image";
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && data[8] === 0x57 && data[9] === 0x45) return "image"; // RIFF....WEBP
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return "xlsx"; // zip container: xlsx / xlsm
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0])) return "xls"; // old OLE2 workbook
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (["csv", "tsv", "txt"].includes(ext)) return "csv";
  // Plain text with no telltale name: accept if it looks like text.
  const sample = data.subarray(0, 2000);
  if (sample.length > 0 && !sample.includes(0)) return "csv";
  return "unknown";
}

/* ---------------- CSV ---------------- */

function decode(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(data); // old bank exports
  }
}

function chooseDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 25);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => l.split(d).length - 1).filter((n) => n > 0);
    const score = counts.length * 100 + (counts.length ? Math.min(...counts) : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** RFC-4180-style parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(input: string | Uint8Array): string[][] {
  const text = typeof input === "string" ? input : decode(input);
  const delimiter = chooseDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/* ---------------- Excel ---------------- */

/** The sheet with the most content (statements are usually the first, but exports sometimes lead with a cover sheet). */
export async function readWorkbook(data: Uint8Array, password?: string): Promise<string[][]> {
  const XLSX = await import("xlsx");
  let wb;
  try {
    wb = XLSX.read(data, { type: "array", dateNF: "yyyy-mm-dd", password, cellDates: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/password|encrypt/i.test(message)) {
      throw new StatementError(password ? "password_incorrect" : "password_required", password ? "That password didn't work. Please try again." : "This workbook is password-protected. Enter its password to continue.");
    }
    throw new StatementError("invalid_pdf", "This spreadsheet couldn't be read. Is it the original export from your bank?");
  }
  let best: string[][] = [];
  let bestCells = 0;
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
    const rows = grid.map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim())).filter((r) => r.some((c) => c !== ""));
    const cells = rows.reduce((t, r) => t + r.filter((c) => c !== "").length, 0);
    if (cells > bestCells) {
      best = rows;
      bestCells = cells;
    }
  }
  return best;
}

/* ---------------- Table -> positioned text ---------------- */

const COL = 140;
const COL_WIDTH = 130;
const CHAR = 5;
const ROW_H = 12;

const MONEY_HEADER = /\b(withdrawal|withdrawals|debit|debits|dr|deposit|deposits|credit|credits|cr|amount|amt|balance|bal|paid out|paid in|money in|money out)\b/i;
const DATE_HEADER = /\b(date|dt|txn date|value date)\b/i;

const AMOUNT_CELL = /^[-+(]?\s*(?:₹|rs\.?|inr)?\s*[\d,]+(?:\.\d+)?\s*\)?\s*(?:cr|dr)?\.?$/i;

/** Row that names the columns: has a date column and at least one money column. */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cells = rows[i];
    if (cells.some((c) => DATE_HEADER.test(c) && c.length < 30) && cells.filter((c) => MONEY_HEADER.test(c) && c.length < 30).length >= 1 && cells.filter(Boolean).length >= 3) return i;
  }
  return -1;
}

/** "1500" -> "1500.00" so a bare integer in a money column reads as money; everything else is left alone. */
function asMoney(cell: string): string {
  const t = cell.replace(/^(?:₹|rs\.?|inr)\s*/i, "").trim();
  if (/^-?\d+$/.test(t.replace(/,/g, "")) && !/\./.test(t)) return `${t}.00`;
  return cell;
}

/** A column that only says which way the money went: "Dr / Cr", "Cr/Dr", "Type", "Txn Type". */
const DIRECTION_HEADER = /^\s*((dr|cr|debit|credit)\s*\/\s*(dr|cr|debit|credit)|type|txn type|transaction type)\s*$/i;
const DIRECTION_CELL = /^\s*(dr|cr|debit|credit|d|c)\.?\s*$/i;
/** "01-10-2026 03:14:53" -> "01-10-2026": the time of day isn't needed and confuses date reading. */
const DATE_WITH_TIME = /^(\d{1,2}[-/.][\w]{2,3}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})[ T]\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i;

/**
 * Some banks (Kotak, among others) export one Amount column plus a separate "Dr / Cr" column, and the
 * same again for the balance. Each direction column is folded into the amount beside it ("72.00" + "CR"
 * becomes "72.00 CR"), which is how a PDF prints it, so the same layout rules read it. Times are dropped from dates.
 */
export function normalizeTable(rows: string[][]): string[][] {
  const headerAt = findHeaderRow(rows);
  const out = rows.map((r) => r.map((c) => (DATE_WITH_TIME.test(c) ? c.replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i, "") : c)));
  if (headerAt < 0) return out;
  const header = out[headerAt];
  const drop = new Set<number>();
  header.forEach((h, i) => {
    if (i === 0 || !DIRECTION_HEADER.test(h) || !MONEY_HEADER.test(header[i - 1] ?? "")) return;
    const below = out.slice(headerAt + 1).map((r) => r[i]).filter(Boolean);
    if (below.length === 0 || below.filter((v) => DIRECTION_CELL.test(v)).length / below.length < 0.8) return;
    drop.add(i);
    for (let r = headerAt + 1; r < out.length; r++) {
      const amount = out[r][i - 1];
      const dir = (out[r][i] ?? "").trim().toUpperCase();
      if (amount && AMOUNT_CELL.test(amount) && DIRECTION_CELL.test(dir)) out[r][i - 1] = `${amount} ${dir.startsWith("C") ? "Cr" : "Dr"}`;
    }
  });
  return drop.size === 0 ? out : out.map((r) => r.filter((_, i) => !drop.has(i)));
}

export function tableToPages(input: string[][]): TextItem[][] {
  const rows = normalizeTable(input);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const headerAt = findHeaderRow(rows);
  const moneyCols = new Set<number>();
  if (headerAt >= 0) {
    rows[headerAt].forEach((c, i) => MONEY_HEADER.test(c) && c.length < 30 && moneyCols.add(i));
  } else {
    // No header: a column whose cells are mostly decimal amounts is a money column.
    for (let c = 0; c < width; c++) {
      const cells = rows.map((r) => r[c]).filter((v): v is string => !!v);
      if (cells.length >= 3 && cells.filter((v) => /^-?[\d,]+\.\d{1,2}$/.test(v)).length / cells.length >= 0.6) moneyCols.add(c);
    }
  }

  const items: TextItem[] = [];
  rows.forEach((cells, r) => {
    const y = 1_000_000 - r * ROW_H;
    cells.forEach((raw, c) => {
      let text = raw;
      if (!text) return;
      const isMoney = moneyCols.has(c) && r !== headerAt && AMOUNT_CELL.test(text);
      if (isMoney) text = asMoney(text);
      const w = Math.min(text.length * CHAR, COL_WIDTH);
      const numeric = moneyCols.has(c);
      const rightEdge = c * COL + COL_WIDTH;
      items.push({ str: text, x: numeric ? rightEdge - w : c * COL, y, width: w, height: 8, page: 1 });
    });
  });
  return [items];
}
