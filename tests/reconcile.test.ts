import { describe, expect, it } from "vitest";
import { reconcile } from "@/lib/statements/reconcile";
import type { ParsedStatement, RawRow } from "@/lib/statements/types";
import { expected, parseFixture } from "./pdf-helpers";

const row = (i: number, over: Partial<RawRow> = {}): RawRow => ({
  index: i, page: 1, date: "2026-09-01", rawDescription: "x", debitMinor: 0, creditMinor: 0, confidence: 1, rawLine: "", warnings: [], ...over,
});
const stmt = (rows: RawRow[], over: Partial<ParsedStatement> = {}): ParsedStatement => ({ parser: "t", rows, warnings: [], ocr: false, ...over });

describe("reconciliation", () => {
  it("passes a real statement whose figures add up", async () => {
    const { parsed } = await parseFixture("hdfc_style.pdf");
    const r = reconcile(parsed);
    expect(r.ok).toBe(true);
    expect(r.verifiable).toBe(true);
    expect(r.differenceMinor).toBe(0);
    expect(r.expectedClosingMinor).toBe(expected.sept.closing);
    expect(r.issues.filter((i) => i.kind !== "low_confidence")).toEqual([]);
  });

  it("passes every layout", async () => {
    for (const f of ["sbi_style.pdf", "single_amount_newest_first.pdf", "headerless.pdf"]) {
      const { parsed } = await parseFixture(f);
      expect(reconcile(parsed).ok, f).toBe(true);
    }
  });

  it("fails — and explains — when a transaction is missing", async () => {
    const { parsed } = await parseFixture("hdfc_style.pdf");
    const missing = { ...parsed, rows: parsed.rows.filter((_, i) => i !== 5) };
    const r = reconcile(missing);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === "balance_jump")).toBe(true);
    expect(r.issues.some((i) => i.kind === "balance_mismatch")).toBe(true);
    const jump = r.issues.find((i) => i.kind === "balance_jump")!;
    expect(jump.message).toMatch(/missing or misread/);
    expect(jump.rowIndex).toBe(5); // the line after the gap
    expect(r.differenceMinor).toBeDefined();
    expect(Math.abs(r.differenceMinor!)).toBe(200_000);
  });

  it("fails when one amount is misread (e.g. OCR 5,000 read as 6,000)", async () => {
    const { parsed } = await parseFixture("hdfc_style.pdf");
    const rows = parsed.rows.map((r, i) => (i === 7 ? { ...r, debitMinor: r.debitMinor + 100_000 } : r));
    const r = reconcile({ ...parsed, rows });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === "balance_jump" && i.rowIndex === 7)).toBe(true);
  });

  it("flags malformed lines: no amount, both amounts, bad date", () => {
    const r = reconcile(stmt([row(0, { debitMinor: 0, creditMinor: 0 }), row(1, { debitMinor: 5, creditMinor: 5 }), row(2, { date: "2026-13-45", debitMinor: 5 })]));
    expect(r.issues.filter((i) => i.kind === "invalid_amount")).toHaveLength(2);
    expect(r.issues.some((i) => i.kind === "invalid_date")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("says so when the statement has no balances to check against", () => {
    const r = reconcile(stmt([row(0, { debitMinor: 100 }), row(1, { creditMinor: 50 })]));
    expect(r.verifiable).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === "no_totals")).toBe(true);
  });

  it("does not treat a derived opening balance as proof", () => {
    // Opening derived from the first line can't catch an error in that line.
    const r = reconcile(stmt([row(0, { debitMinor: 100, balanceMinor: 900 })], { openingBalanceMinor: 1000, openingDerived: true }));
    expect(r.verifiable).toBe(false);
  });

  it("flags lines dated outside the statement period (as information, not a blocker)", () => {
    const r = reconcile(stmt([row(0, { date: "2026-08-30", debitMinor: 100, balanceMinor: 900 })], { openingBalanceMinor: 1000, periodStart: "2026-09-01", periodEnd: "2026-09-30" }));
    expect(r.issues.some((i) => i.kind === "date_out_of_period")).toBe(true);
    expect(r.ok).toBe(true);
  });
});

describe("overdrawn accounts", () => {
  it("accepts balances printed without their minus sign", () => {
    // 1,000 -> pay 1,500 -> overdrawn by 500 (printed 500) -> pay 100 -> overdrawn by 600 (printed 600) -> +1,600 -> 1,000
    const r = reconcile(
      stmt(
        [
          row(0, { debitMinor: 150000, balanceMinor: 50000 }),
          row(1, { debitMinor: 10000, balanceMinor: 60000 }),
          row(2, { creditMinor: 160000, balanceMinor: 100000 }),
        ],
        { openingBalanceMinor: 100000, closingBalanceMinor: 100000 },
      ),
    );
    expect(r.issues.filter((i) => i.kind === "balance_jump")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("still catches a real error next to an overdraft", () => {
    const r = reconcile(stmt([row(0, { debitMinor: 150000, balanceMinor: 50000 }), row(1, { debitMinor: 10000, balanceMinor: 99999 })], { openingBalanceMinor: 100000 }));
    expect(r.issues.some((i) => i.kind === "balance_jump" && i.rowIndex === 1)).toBe(true);
  });
});
