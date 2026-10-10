import { describe, expect, it } from "vitest";
import { calendarMonth, expectedPayments, monthOutlook, type CalendarCardDue } from "@/lib/finance/calendar";
import { cardDueDates } from "@/lib/finance/card-bill-status";
import type { RecurringCharge } from "@/lib/finance/recurring";
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

describe("expectedPayments", () => {
  const netflix = {
    key: "netflix", name: "Netflix", categoryId: "subscriptions", amountMinor: 64900, frequency: "monthly", kind: "subscription",
    brand: "netflix", lastDate: "2026-09-12", nextDate: "2026-10-12", occurrences: 4, monthlyEquivalentMinor: 64900,
  } as RecurringCharge;
  const rent = { ...netflix, key: "rent", name: "Rent", categoryId: "rent", amountMinor: 2500000, kind: "recurring", brand: undefined, lastDate: "2026-09-08", nextDate: "2026-10-08" } as RecurringCharge;

  it("puts each turn on its day, counted from the last real payment", () => {
    const got = expectedPayments([netflix], "2026-10-10", "2026-09-27", "2026-12-31");
    expect(got.map((p) => p.date)).toEqual(["2026-10-12", "2026-11-12", "2026-12-12"]);
    expect(got.every((p) => !p.overdue)).toBe(true);
  });

  it("keeps a payment a few days late as overdue, and drops one missed for longer", () => {
    expect(expectedPayments([rent], "2026-10-10", "2026-10-01", "2026-10-31")).toEqual([{ date: "2026-10-08", charge: rent, overdue: true }]);
    expect(expectedPayments([rent], "2026-10-15", "2026-10-01", "2026-11-30").map((p) => p.date)).toEqual(["2026-11-08"]);
  });

  it("leaves out a rhythm only guessed from a single payment", () => {
    const godaddy = { ...netflix, key: "godaddy", name: "GoDaddy", brand: "godaddy", occurrences: 1, assumed: true } as RecurringCharge;
    expect(expectedPayments([godaddy], "2026-10-10", "2026-09-27", "2026-12-31")).toEqual([]);
  });

  it("is gone once the payment is recorded", () => {
    const paid = { ...rent, lastDate: "2026-10-09", nextDate: "2026-11-09" };
    expect(expectedPayments([paid], "2026-10-10", "2026-10-01", "2026-10-31")).toEqual([]);
  });

  it("doesn't drift at the end of the month", () => {
    const emi = { ...rent, lastDate: "2026-08-31" };
    expect(expectedPayments([emi], "2026-09-01", "2026-09-01", "2026-12-31").map((p) => p.date)).toEqual(["2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"]);
  });

  it("adds up what's still to come this month, with unpaid card bills apart", () => {
    const expected = expectedPayments([netflix, rent], "2026-10-10", "2026-09-27", "2026-10-31");
    const dues: CalendarCardDue[] = [
      { accountId: "Card", cardName: "Card", statementDate: "2026-09-25", dueDate: "2026-10-15", billMinor: 500000, paidMinor: 100000, remainingMinor: 400000, latest: true },
      { accountId: "Card", cardName: "Card", statementDate: "2026-08-25", dueDate: "2026-09-15", billMinor: 300000, paidMinor: 0, remainingMinor: 300000, latest: false },
    ];
    expect(monthOutlook("2026-10", "2026-10-10", expected, dues)).toEqual({ expectedMinor: 2564900, expectedCount: 2, cardBillsMinor: 400000, cardBillCount: 1 });
    expect(monthOutlook("2026-08", "2026-10-10", expected, dues)).toBeNull();
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
