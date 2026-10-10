import { describe, expect, it } from "vitest";
import { StatementError } from "@/lib/statements/types";
import { expected, nodePdfjs, parseFixture, fixture } from "./pdf-helpers";
import { extractPdfText } from "@/lib/statements/pdf";

const ALL_LAYOUTS = [
  ["hdfc_style.pdf", "GenericTableParser"],
  ["sbi_style.pdf", "GenericTableParser"],
  ["single_amount_newest_first.pdf", "GenericTableParser"],
  ["headerless.pdf", "GenericLineParser"],
] as const;

describe.each(ALL_LAYOUTS)("reading %s", (file, parserName) => {
  it("finds every transaction with the right date, amount, direction and balance", async () => {
    const { parsed } = await parseFixture(file);
    expect(parsed.parser).toBe(parserName);
    expect(parsed.rows).toHaveLength(expected.sept.rows.length);
    parsed.rows.forEach((row, i) => {
      const want = expected.sept.rows[i];
      expect(row.date, `row ${i} date`).toBe(want.date);
      expect(row.debitMinor, `row ${i} debit`).toBe(want.debit);
      expect(row.creditMinor, `row ${i} credit`).toBe(want.credit);
      expect(row.balanceMinor, `row ${i} balance`).toBe(want.balance);
      expect(row.index).toBe(i);
    });
  });

  it("keeps the whole narration, including lines that wrapped", async () => {
    const { parsed } = await parseFixture(file);
    const squash = (s: string) => s.replace(/[\s-]+/g, "").toUpperCase();
    parsed.rows.forEach((row, i) => {
      expect(squash(row.rawDescription), `row ${i}`).toContain(squash(expected.sept.rows[i].narration).slice(0, 24));
    });
  });
});

describe("statement-level facts", () => {
  it("reads opening, closing, period, account and bank from a summary-style statement", async () => {
    const { parsed } = await parseFixture("hdfc_style.pdf");
    expect(parsed.openingBalanceMinor).toBe(expected.sept.opening);
    expect(parsed.closingBalanceMinor).toBe(expected.sept.closing);
    expect(parsed.periodStart).toBe("2026-09-01");
    expect(parsed.periodEnd).toBe("2026-09-30");
    expect(parsed.accountMask).toBe("6789");
    expect(parsed.bankHint).toBe("HDFC Bank");
  });

  it("reads the opening/closing lines of an SBI-style statement and a masked account number", async () => {
    const { parsed } = await parseFixture("sbi_style.pdf");
    expect(parsed.openingBalanceMinor).toBe(expected.sept.opening);
    expect(parsed.closingBalanceMinor).toBe(expected.sept.closing);
    expect(parsed.accountMask).toBe("7788");
    expect(parsed.bankHint).toBe("State Bank of India");
    expect(parsed.periodStart).toBe("2026-09-01");
  });

  it("puts a newest-first statement into oldest-first order", async () => {
    const { parsed } = await parseFixture("single_amount_newest_first.pdf");
    expect(parsed.rows[0].date).toBe("2026-09-01");
    expect(parsed.rows[parsed.rows.length - 1].date).toBe("2026-09-28");
    expect(parsed.openingBalanceMinor).toBe(expected.sept.opening);
  });

  it("derives the opening balance when the statement doesn't print one", async () => {
    const { parsed } = await parseFixture("headerless.pdf");
    expect(parsed.openingBalanceMinor).toBe(expected.sept.opening);
    expect(parsed.warnings.join(" ")).toMatch(/header/i);
  });
});

describe("parsing multi-page statements", () => {
  it("handles repeated headers across page breaks without duplicating or dropping rows", async () => {
    const { extracted, parsed } = await parseFixture("hdfc_style.pdf");
    expect(extracted.pageCount).toBe(2);
    expect(parsed.rows.map((r) => r.page)).toContain(1);
    expect(parsed.rows.map((r) => r.page)).toContain(2);
    expect(new Set(parsed.rows.map((r) => `${r.date}|${r.balanceMinor}`)).size).toBe(parsed.rows.length);
  });

  it("reads the overlapping later statement too", async () => {
    const { parsed } = await parseFixture("overlap.pdf");
    expect(parsed.rows).toHaveLength(expected.overlap.rows.length);
    expect(parsed.openingBalanceMinor).toBe(expected.overlap.opening);
    expect(parsed.rows[0].date).toBe(expected.overlap.rows[0].date);
  });
});

describe("files that can't be read", () => {
  it("asks for a password on a protected PDF, and rejects a wrong one", async () => {
    const pdfjs = await nodePdfjs();
    await expect(extractPdfText(fixture("protected.pdf"), pdfjs)).rejects.toMatchObject({ code: "password_required" });
    await expect(extractPdfText(fixture("protected.pdf"), pdfjs, "wrong")).rejects.toMatchObject({ code: "password_incorrect" });
  });

  it("reads a protected PDF with the right password", async () => {
    const { parsed } = await parseFixture("protected.pdf", expected.password);
    expect(parsed.rows).toHaveLength(expected.sept.rows.length);
  });

  it("rejects a file that isn't a PDF", async () => {
    await expect(parseFixture("garbage.pdf")).rejects.toBeInstanceOf(StatementError);
    await expect(parseFixture("garbage.pdf")).rejects.toMatchObject({ code: "invalid_pdf" });
  });

  it("finds no transactions in a letter or a blank page, without crashing", async () => {
    for (const f of ["not_a_statement.pdf", "blank.pdf"]) {
      const { parsed } = await parseFixture(f);
      expect(parsed.rows, f).toHaveLength(0);
    }
  });

  it("recognises a scanned PDF as having no text layer", async () => {
    const { extracted } = await parseFixture("scanned.pdf");
    expect(extracted.scannedPages).toEqual([1, 2]);
    expect(extracted.charCount).toBeLessThan(10);
  });
});

describe("naming the statement's bank", () => {
  // One text item per cell; each row is a line further down the page.
  function page(rows: string[][]) {
    const xs = [40, 120, 330, 410, 490];
    return rows.flatMap((cells, r) => cells.map((str, c) => ({ str, x: xs[c], y: 800 - r * 20, width: str.length * 5, height: 10, page: 1 })));
  }
  const table = [
    ["Date", "Narration", "Withdrawal", "Deposit", "Balance"],
    ["09/10/2026", "UPI/ZOMATO/zomato@hdfcbank", "250.00", "", "9,750.00"],
    ["10/10/2026", "SALARY", "", "1,000.00", "10,750.00"],
  ];

  it("takes the bank named at the top, not one that appears lower down or later in the list", async () => {
    const { parseStatementItems } = await import("@/lib/statements/table-parser");
    const parsed = parseStatementItems([page([
      ["Kotak Mahindra Bank"],
      ["Statement of account"],
      ["IFSC: KKBK0001234   Nominee bank: HDFC"],
      ...table,
    ])], { ocr: false });
    expect(parsed.bankHint).toBe("Kotak Mahindra Bank");
  });

  it("ignores banks named in payment lines and HDFC Life / ICICI Prudential", async () => {
    const { parseStatementItems } = await import("@/lib/statements/table-parser");
    const parsed = parseStatementItems([page([
      ["Account statement"],
      ["HDFC Life premium reminder"],
      ["UPI ref to merchant@okhdfcbank"],
      ...table,
    ])], { ocr: false });
    expect(parsed.bankHint).toBeUndefined();
  });
});
