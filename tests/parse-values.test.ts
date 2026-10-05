import { describe, expect, it } from "vitest";
import { looksLikeDecimalAmount, parseAmount, parseStatementDate, startsWithDate } from "@/lib/statements/parse-values";

describe("statement dates", () => {
  it.each([
    ["05/09/2026", "2026-09-05"],
    ["05-09-2026", "2026-09-05"],
    ["05.09.2026", "2026-09-05"],
    ["05/09/26", "2026-09-05"],
    ["5/9/26", "2026-09-05"],
    ["05 Sep 2026", "2026-09-05"],
    ["05-Sep-26", "2026-09-05"],
    ["05-SEP-2026", "2026-09-05"],
    ["5th Sep 2026", "2026-09-05"],
    ["05Sep2026", "2026-09-05"],
    ["Sep 5, 2026", "2026-09-05"],
    ["2026-09-05", "2026-09-05"],
    ["29/02/2024", "2024-02-29"],
    ["31 Dec 99", "1999-12-31"],
  ])("reads %s as %s", (input, expected) => {
    expect(parseStatementDate(input)).toBe(expected);
  });

  it("treats numeric dates as day-first", () => {
    expect(parseStatementDate("03/04/2026")).toBe("2026-04-03");
  });

  it.each(["31/02/2026", "00/01/2026", "13/13/2026", "hello", "", "1234", "₹500.00", "29/02/2026"])("rejects %s", (input) => {
    expect(parseStatementDate(input)).toBeNull();
  });

  it("spots a line that starts with a date", () => {
    expect(startsWithDate("05/09/2026 UPI/123/SWIGGY")).toBe(true);
    expect(startsWithDate("05 Sep 2026 Swiggy")).toBe(true);
    expect(startsWithDate("2026-09-05 x")).toBe(true);
    expect(startsWithDate("Opening Balance 1,000.00")).toBe(false);
    expect(startsWithDate("12345678 ref")).toBe(false);
  });
});

describe("statement amounts", () => {
  it.each([
    ["850.00", 85_000, null],
    ["1,23,456.78", 12_345_678, null],
    ["1,234.50", 123_450, null],
    ["₹2,400", 240_000, null],
    ["Rs. 99.9", 9_990, null],
    ["INR 500.00", 50_000, null],
    ["(500.00)", 50_000, "debit"],
    ["-500.00", 50_000, "debit"],
    ["500.00 Dr", 50_000, "debit"],
    ["500.00Cr", 50_000, "credit"],
    ["0.00", 0, null],
    ["12", 1_200, null],
  ])("reads %s", (input, minor, sign) => {
    expect(parseAmount(input)).toEqual({ minor, sign });
  });

  it.each(["", "abc", "12/09/2026", "1.2.3", "UPI", "5,00,000.123", "₹"])("rejects %s", (input) => {
    expect(parseAmount(input)).toBeNull();
  });

  it("only treats text as a free-standing amount when it has a decimal part", () => {
    expect(looksLikeDecimalAmount("1,234.50")).toBe(true);
    expect(looksLikeDecimalAmount("1,234.50 Cr")).toBe(true);
    expect(looksLikeDecimalAmount("403821907312")).toBe(false);
    expect(looksLikeDecimalAmount("2026")).toBe(false);
  });
});
