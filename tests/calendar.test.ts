import { describe, expect, it } from "vitest";
import { calendarMonth } from "@/lib/finance/calendar";
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
