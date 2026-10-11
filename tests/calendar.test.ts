import { describe, expect, it } from "vitest";
import { calendarMonth, monthPace, spendLevels } from "@/lib/finance/calendar";
import { cardDueDates } from "@/lib/finance/card-bill-status";
import { buildLedger } from "@/lib/finance/engine";
import { periodReport } from "@/lib/finance/state";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const t = "2026-09-01T00:00:00Z";
const ev = (id: string, date: string, e: Record<string, unknown>) => ({ id, date, createdAt: t, updatedAt: t, ...e }) as unknown as FinancialEvent;

const book: Book = {
  accounts: [
    { id: "Kotak", name: "Kotak", type: "bank", openingBalanceMinor: 2000000, openedOn: "2026-01-01", createdAt: t },
    { id: "Card", name: "Card", type: "credit_card", openingBalanceMinor: 0, openedOn: "2026-01-01", createdAt: t },
  ],
  people: [],
  events: [
    ev("1", "2026-10-01", { type: "income", accountId: "Kotak", amountMinor: 4480600, categoryId: "salary" }),
    ev("2", "2026-10-02", { type: "expense", accountId: "Kotak", amountMinor: 120000, categoryId: "food" }),
    ev("3", "2026-10-02", { type: "expense", accountId: "Card", amountMinor: 30000, categoryId: "shopping", description: "Amazon" }),
    ev("4", "2026-10-04", { type: "income", accountId: "Card", amountMinor: 10000, categoryId: "refund", description: "Amazon" }),
    ev("5", "2026-10-05", { type: "transfer", fromAccountId: "Kotak", toAccountId: "Card", amountMinor: 70000 }),
    ev("6", "2026-11-01", { type: "expense", accountId: "Kotak", amountMinor: 5000, categoryId: "food" }),
  ],
};
const ledger = buildLedger(book);
const weeks = calendarMonth(book, ledger, "2026-10");
const days = weeks.flat();
const day = (date: string) => days.find((d) => d.date === date)!;

describe("calendarMonth", () => {
  it("lays the month out as whole Sunday-to-Saturday weeks", () => {
    // 1 Oct 2026 is a Thursday; 31 Oct is a Saturday.
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(days[0]).toMatchObject({ date: "2026-09-27", inMonth: false });
    expect(days.at(-1)).toMatchObject({ date: "2026-10-31", inMonth: true });
  });

  it("shows each day's income and spending, with refunds off spending and transfers in neither", () => {
    expect(day("2026-10-01")).toMatchObject({ incomeMinor: 4480600, expensesMinor: 0, entryCount: 1 });
    expect(day("2026-10-02")).toMatchObject({ incomeMinor: 0, expensesMinor: 150000, entryCount: 2 });
    expect(day("2026-10-04")).toMatchObject({ incomeMinor: 0, expensesMinor: -10000 });
    expect(day("2026-10-05")).toMatchObject({ incomeMinor: 0, expensesMinor: 0, entryCount: 1 });
  });

  it("adds up to the month's report", () => {
    const month = periodReport(book, ledger, "2026-10-01", "2026-10-31");
    const inMonth = days.filter((d) => d.inMonth);
    expect(inMonth.reduce((s, d) => s + d.incomeMinor, 0)).toBe(month.incomeMinor);
    expect(inMonth.reduce((s, d) => s + d.expensesMinor, 0)).toBe(month.expensesMinor);
  });
});

describe("cardDueDates", () => {
  it("marks each printed due date with how much of that bill was paid", () => {
    const cardBook: Book = {
      ...book,
      events: [ev("p", "2026-10-05", { type: "transfer", fromAccountId: "Kotak", toAccountId: "Card", amountMinor: 70000 })],
    };
    const bills = [
      { statementDate: "2026-08-25", dueDate: "2026-09-15", totalDueMinor: 50000 },
      { statementDate: "2026-09-25", dueDate: "2026-10-15", totalDueMinor: 100000 },
      { statementDate: "2026-09-25", dueDate: "2026-10-15", totalDueMinor: 100000 }, // the same statement uploaded twice
      { statementDate: "2026-07-25", totalDueMinor: 20000 }, // no due date printed
    ];
    expect(cardDueDates(cardBook, "Card", bills)).toEqual([
      { statementDate: "2026-08-25", dueDate: "2026-09-15", billMinor: 50000, paidMinor: 0, remainingMinor: 50000, latest: false },
      { statementDate: "2026-09-25", dueDate: "2026-10-15", billMinor: 100000, paidMinor: 70000, remainingMinor: 30000, latest: true },
    ]);
  });
});

describe("monthPace", () => {
  const paceBook: Book = {
    ...book,
    events: [
      ev("s1", "2026-09-03", { type: "expense", accountId: "Kotak", amountMinor: 50000, categoryId: "food" }),
      ev("s2", "2026-09-20", { type: "expense", accountId: "Kotak", amountMinor: 200000, categoryId: "food" }),
      ev("o1", "2026-10-05", { type: "expense", accountId: "Kotak", amountMinor: 80000, categoryId: "food" }),
    ],
  };
  const paceLedger = buildLedger(paceBook);

  it("compares the days so far with the same days last month, and carries the pace to the month's end", () => {
    expect(monthPace(paceBook, paceLedger, "2026-10", "2026-10-10", 80000)).toEqual({
      previousMonth: "2026-09",
      previousMinor: 50000, // 1-10 Sep only
      wholeMonth: false,
      projectedMinor: 248000, // 800 a day for 31 days
    });
  });

  it("compares whole months once a month is over", () => {
    expect(monthPace(paceBook, paceLedger, "2026-10", "2026-11-02", 80000)).toMatchObject({ previousMinor: 250000, wholeMonth: true, projectedMinor: null });
  });

  it("stops at the end of a shorter month before", () => {
    const b: Book = { ...book, events: [ev("f", "2026-02-28", { type: "expense", accountId: "Kotak", amountMinor: 1000, categoryId: "food" })] };
    expect(monthPace(b, buildLedger(b), "2026-03", "2026-03-30", 0)?.previousMinor).toBe(1000);
  });

  it("has nothing to compare with when last month has no entries, and nothing at all for a future month", () => {
    expect(monthPace(paceBook, paceLedger, "2026-09", "2026-09-10", 50000)?.previousMinor).toBeNull();
    expect(monthPace(paceBook, paceLedger, "2026-11", "2026-10-10", 0)).toBeNull();
  });
});

describe("spendLevels", () => {
  const d = (date: string, expensesMinor: number, inMonth = true) => ({ date, inMonth, incomeMinor: 0, expensesMinor, entryCount: 1 });

  it("grades days against the month, with the top set by the 90th-percentile day so one big payment doesn't wash out the rest", () => {
    const days = [...Array.from({ length: 9 }, (_, i) => d(`2026-10-0${i + 1}`, (i + 1) * 1000)), d("2026-10-10", 500000)];
    const levels = spendLevels(days);
    expect(levels.get("2026-10-10")).toBe(4);
    expect(levels.get("2026-10-09")).toBe(4); // the 90th-percentile day tops the scale too
    expect(levels.get("2026-10-05")).toBe(3); // 5000 of 9000
    expect(levels.get("2026-10-01")).toBe(1); // small, but still shaded
  });

  it("leaves out days with no spending, money back, or outside the month", () => {
    const levels = spendLevels([d("2026-10-01", 0), d("2026-10-02", -500), d("2026-09-30", 9000, false), d("2026-10-03", 100)]);
    expect([...levels]).toEqual([["2026-10-03", 4]]);
  });
});
