import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "@/lib/domain/categories";
import { defaultAccounts } from "@/lib/finance/migrate";
import { processStatement } from "@/lib/statements/pipeline";
import { detectFormat, parseCsv } from "@/lib/statements/tabular";
import { emptyImportStore, StatementError } from "@/lib/statements/types";
import { expected, fixture, nodePdfjs } from "./pdf-helpers";

const rows = expected.sept.rows;
const rupees = (minor: number) => (minor / 100).toFixed(2);
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const enc = (s: string) => new TextEncoder().encode(s);

const book = { accounts: defaultAccounts("2026-01-01T00:00:00Z").map((a) => (a.id === "account-netbanking" ? { ...a, openingBalanceMinor: expected.sept.opening, openedOn: "2026-08-01" } : a)), people: [], events: [] };
const categories = { expenseCategories: DEFAULT_CATEGORIES, incomeCategories: DEFAULT_INCOME_CATEGORIES };

let n = 0;
async function run(data: Uint8Array, filename: string, password?: string) {
  return processStatement(
    { data, filename, accountId: "account-netbanking", book, store: emptyImportStore(), categories, useAi: false, password },
    { pdfjs: await nodePdfjs(), now: () => "2026-10-05T10:00:00Z", newId: () => `f${++n}` },
  );
}

/** How closely did we read the same transactions the PDF test expects? */
function assertSeptember(out: Awaited<ReturnType<typeof run>>) {
  expect(out.rows).toHaveLength(rows.length);
  out.rows.forEach((r, i) => {
    expect(r.transactionDate).toBe(rows[i].date);
    expect(r.debitMinor).toBe(rows[i].debit);
    expect(r.creditMinor).toBe(rows[i].credit);
    expect(r.balanceAfterMinor).toBe(rows[i].balance);
    expect(r.rawDescription).toBe(rows[i].narration);
  });
  expect(out.record.reconciliation?.ok).toBe(true);
  expect(out.record.closingBalanceMinor ?? out.record.reconciliation?.actualClosingMinor).toBe(expected.sept.closing);
}

const csvEscape = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (grid: string[][], d = ",") => grid.map((r) => r.map(csvEscape).join(d)).join("\r\n");

const header = ["Date", "Narration", "Chq./Ref.No.", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"];
const bankGrid = (order: "old" | "new" = "old"): string[][] => {
  const body = rows.map((r) => [dmy(r.date), r.narration + ", Mumbai", "", r.debit ? rupees(r.debit) : "", r.credit ? rupees(r.credit) : "", rupees(r.balance)]);
  const txns = order === "old" ? body : [...body].reverse();
  return [
    ["HDFC BANK LIMITED"],
    ["Account No : 50100123456789"],
    ["Statement From : 01/09/2026 To : 30/09/2026"],
    [],
    header,
    ...txns,
    [],
    ["STATEMENT SUMMARY"],
    ["Opening Balance", "Debits", "Credits", "Closing Bal"],
    [rupees(expected.sept.opening), "", "", rupees(expected.sept.closing)],
  ];
};

describe("detecting the file type", () => {
  it("goes by content, not by name", () => {
    expect(detectFormat(fixture("hdfc_style.pdf"), "statement.csv")).toBe("pdf");
    expect(detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), "x.pdf")).toBe("image");
    expect(detectFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "x")).toBe("image");
    expect(detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "x.csv")).toBe("xlsx");
    expect(detectFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "x")).toBe("xls");
    expect(detectFormat(enc("a,b\n1,2"), "export")).toBe("csv");
    expect(detectFormat(new Uint8Array([0, 1, 2, 3, 0]), "mystery.bin")).toBe("unknown");
  });
});

describe("csv parsing", () => {
  it("handles quotes, commas inside fields, doubled quotes and other delimiters", () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n1,2,3')).toEqual([["a", "b, c", 'd "q"'], ["1", "2", "3"]]);
    expect(parseCsv("a;b;c\n1,5;2;3")).toEqual([["a", "b", "c"], ["1,5", "2", "3"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("﻿x,y\n\n1,2\n")).toEqual([["x", "y"], ["1", "2"]]);
  });
});

describe("importing a CSV statement", () => {
  it("reads a bank export with a preamble, debit/credit columns and a summary", async () => {
    const out = await run(enc(toCsv(bankGrid())), "hdfc.csv");
    assertSeptember({ ...out, rows: out.rows.map((r, i) => ({ ...r, rawDescription: rows[i].narration })) } as typeof out);
    expect(out.record.openingBalanceMinor).toBe(expected.sept.opening);
    expect(out.record.bankHint).toBe("HDFC Bank");
  });

  it("copes with newest-first order and semicolon delimiters", async () => {
    const out = await run(enc(toCsv(bankGrid("new"), ";")), "export.csv");
    expect(out.rows).toHaveLength(rows.length);
    expect(out.rows[0].transactionDate).toBe(rows[0].date);
    expect(out.record.reconciliation?.ok).toBe(true);
  });

  it("reads a single Amount column with a Dr/Cr type column", async () => {
    const grid = [
      ["Txn Date", "Description", "Amount", "Dr/Cr", "Balance"],
      ...rows.map((r) => [dmy(r.date), r.narration.replace(/,/g, " "), rupees(r.debit || r.credit), r.debit ? "DR" : "CR", rupees(r.balance)]),
    ];
    const out = await run(enc(toCsv(grid)), "single.csv");
    expect(out.rows).toHaveLength(rows.length);
    expect(out.rows.map((r) => [r.debitMinor, r.creditMinor])).toEqual(rows.map((r) => [r.debit, r.credit]));
    expect(out.record.reconciliation?.ok).toBe(true);
  });

  it("reads amounts with thousands separators and no decimals", async () => {
    const grid = [
      ["Date", "Particulars", "Debit", "Credit", "Balance"],
      ["01-09-2026", "Salary", "", "85,000", "1,35,000"],
      ["02-09-2026", "Rent to Amit", "18,000", "", "1,17,000"],
    ];
    const out = await run(enc(toCsv(grid)), "plain.csv");
    expect(out.rows.map((r) => [r.creditMinor, r.debitMinor, r.balanceAfterMinor])).toEqual([[8500000, 0, 13500000], [0, 1800000, 11700000]]);
  });
});

describe("importing an Excel statement", () => {
  const workbook = (grid: (string | number)[][], bookType: XLSX.BookType) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Cover sheet"]]), "Cover");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), "Statement");
    return new Uint8Array(XLSX.write(wb, { type: "array", bookType }));
  };

  // Real numbers in real cells, as a bank's Excel export has them.
  const numericGrid = (): (string | number)[][] => [
    ["HDFC BANK LIMITED"],
    ["Statement From : 01/09/2026 To : 30/09/2026"],
    header,
    ...rows.map((r) => [dmy(r.date), r.narration, "", r.debit ? r.debit / 100 : "", r.credit ? r.credit / 100 : "", r.balance / 100]),
    ["Opening Balance", "", "", "", "", expected.sept.opening / 100],
  ];

  it("reads .xlsx with numeric cells and ignores a cover sheet", async () => {
    const out = await run(workbook(numericGrid(), "xlsx"), "statement.xlsx");
    expect(out.rows).toHaveLength(rows.length);
    expect(out.rows.map((r) => [r.debitMinor, r.creditMinor, r.balanceAfterMinor])).toEqual(rows.map((r) => [r.debit, r.credit, r.balance]));
    expect(out.record.reconciliation?.ok).toBe(true);
  });

  it("reads the old .xls format too", async () => {
    const out = await run(workbook(numericGrid(), "biff8"), "statement.xls");
    expect(out.rows).toHaveLength(rows.length);
    expect(out.record.reconciliation?.ok).toBe(true);
  });

  it("detects a renamed file by content", async () => {
    const out = await run(workbook(numericGrid(), "xlsx"), "download.dat");
    expect(out.rows).toHaveLength(rows.length);
  });
});

describe("files that can't be imported", () => {
  it("says clearly when it isn't a statement", async () => {
    await expect(run(enc("hello world, this is not a statement"), "notes.txt")).rejects.toBeInstanceOf(StatementError);
    await expect(run(enc(toCsv([["Name", "Age"], ["A", "3"], ["B", "4"]])), "people.csv")).rejects.toMatchObject({ code: "unsupported_format" });
    await expect(run(new Uint8Array([0, 1, 2, 3, 0, 0, 0]), "x.bin")).rejects.toMatchObject({ code: "unsupported_format" });
  });

  it("reports a photo as unreadable when OCR isn't available", async () => {
    await expect(run(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), "shot.png")).rejects.toMatchObject({ code: "ocr_failed" });
  });

  it("still catches an altered spreadsheet through the balances", async () => {
    const grid = bankGrid().map((r) => [...r]);
    const idx = grid.findIndex((r) => r[1]?.startsWith("UPI-SWIGGY"));
    grid[idx][3] = "950.00"; // a debit changed from 850 to 950
    const out = await run(enc(toCsv(grid)), "edited.csv");
    expect(out.record.reconciliation?.ok).toBe(false);
  });
});

describe("importing a photo of a statement", () => {
  it("reads a JPG with OCR and runs it through the same checks", async () => {
    const { createOcrWorker, recognizePage } = await import("@/lib/statements/ocr");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { FIXTURES } = await import("./pdf-helpers");
    const worker = await createOcrWorker();
    try {
      const jpg = new Uint8Array(readFileSync(join(FIXTURES, "scanned_p1.jpg")));
      expect(detectFormat(jpg, "IMG_0042.JPG")).toBe("image");
      const out = await processStatement(
        { data: jpg, filename: "IMG_0042.JPG", accountId: "account-netbanking", book, store: emptyImportStore(), categories, useAi: false },
        {
          pdfjs: await nodePdfjs(),
          now: () => "2026-10-05T10:00:00Z",
          newId: () => `img${++n}`,
          ocrImage: async (image) => (await recognizePage(worker, image, 1, 2.2, 842)).items,
        },
      );
      expect(out.record.ocr).toBe(true);
      expect(out.rows.length).toBeGreaterThanOrEqual(6);
      expect(out.rows.every((r) => r.amountMinor > 0 && /^2026-/.test(r.transactionDate))).toBe(true);
    } finally {
      await worker.terminate();
    }
  }, 120_000);
});
