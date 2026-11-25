import { describe, expect, it } from "vitest";
import { buildLedger } from "@/lib/finance/engine";
import { explainIncome, explainNetWorthChange, explainSpent } from "@/lib/finance/explain";
import { balanceSeries, changeBps, monthlySummaries } from "@/lib/finance/series";
import { deriveState, periodReport } from "@/lib/finance/state";
import { monthEnd, monthStart, shiftMonth } from "@/lib/domain/dates";
import type { Book, FinancialEvent } from "@/lib/finance/types";

/*
 * The dashboard's month switcher shows, for an earlier month, figures worked out a second way (the balance sheet at
 * the month's end, the month's own report). They must agree with everything else that shows the same month: the
 * net worth chart, the Spending card's monthly bars, Earned & spent, and the "how it adds up" sheets.
 */

const t = "2026-08-01T00:00:00Z";
const acc = (id: string, type: "bank" | "cash" | "credit_card" | "loan" | "investment", open = 0, openedOn = "2026-08-01") => ({ id, name: id, type, openingBalanceMinor: open, openedOn, createdAt: t });
const ev = (id: string, date: string, e: Record<string, unknown>) => ({ id, date, createdAt: t, updatedAt: t, ...e }) as unknown as FinancialEvent;

// Four months of a varied life: salary, spending on bank / card / cash, a card bill, refunds, lending and borrowing,
// a loan and its EMIs, investing and the value moving, and money kept for someone.
const book: Book = {
  accounts: [acc("Bank", "bank", 5_000_000), acc("Cash", "cash", 200_000), acc("Card", "credit_card", 0), acc("Car loan", "loan", 40_000_000, "2026-09-10"), acc("Fund", "investment")],
  people: [
    { id: "rahul", name: "Rahul", createdAt: t },
    { id: "priya", name: "Priya", createdAt: t },
  ],
  events: [
    // August
    ev("a1", "2026-08-01", { type: "income", accountId: "Bank", amountMinor: 12_000_000, categoryId: "salary" }),
    ev("a2", "2026-08-03", { type: "expense", accountId: "Bank", amountMinor: 2_500_000, categoryId: "rent" }),
    ev("a3", "2026-08-09", { type: "expense", accountId: "Card", amountMinor: 450_000, categoryId: "shopping", description: "Amazon" }),
    ev("a4", "2026-08-15", { type: "expense", accountId: "Cash", amountMinor: 60_000, categoryId: "food" }),
    ev("a5", "2026-08-20", { type: "lend", personId: "rahul", accountId: "Bank", amountMinor: 1_000_000 }),
    ev("a6", "2026-08-25", { type: "invest", fromAccountId: "Bank", holdingId: "Fund", amountMinor: 2_000_000 }),
    ev("a7", "2026-08-31", { type: "expense", accountId: "Card", amountMinor: 120_000, categoryId: "food" }),
    // September
    ev("s1", "2026-09-01", { type: "income", accountId: "Bank", amountMinor: 12_000_000, categoryId: "salary" }),
    ev("s2", "2026-09-02", { type: "transfer", fromAccountId: "Bank", toAccountId: "Card", amountMinor: 570_000 }),
    ev("s3", "2026-09-04", { type: "income", accountId: "Card", amountMinor: 50_000, categoryId: "refund", description: "Amazon" }),
    ev("s4", "2026-09-10", { type: "expense", accountId: "Bank", amountMinor: 2_500_000, categoryId: "rent" }),
    ev("s5", "2026-09-12", { type: "repayment_received", personId: "rahul", accountId: "Bank", amountMinor: 400_000 }),
    ev("s6", "2026-09-18", { type: "borrow", personId: "priya", accountId: "Bank", amountMinor: 3_000_000 }),
    ev("s7", "2026-09-30", { type: "update_valuation", holdingId: "Fund", valueMinor: 2_150_000 }),
    ev("s8", "2026-09-30", { type: "expense", accountId: "Card", amountMinor: 89_900, categoryId: "subscriptions", description: "Netflix" }),
    // October
    ev("o1", "2026-10-01", { type: "income", accountId: "Bank", amountMinor: 12_500_000, categoryId: "salary" }),
    ev("o2", "2026-10-05", { type: "emi_payment", fromAccountId: "Bank", toAccountId: "Car loan", amountMinor: 900_000, interestMinor: 250_000, categoryId: "interest" }),
    ev("o3", "2026-10-07", { type: "expense", accountId: "Bank", amountMinor: 2_500_000, categoryId: "rent" }),
    ev("o4", "2026-10-11", { type: "expense", accountId: "Cash", amountMinor: 35_000, categoryId: "food" }),
    ev("o5", "2026-10-15", { type: "repayment_made", personId: "priya", accountId: "Bank", amountMinor: 1_000_000 }),
    ev("o6", "2026-10-20", { type: "invest", fromAccountId: "Bank", holdingId: "Fund", amountMinor: 500_000 }),
    ev("o7", "2026-10-31", { type: "update_valuation", holdingId: "Fund", valueMinor: 2_590_000 }),
    // November (in progress)
    ev("n1", "2026-11-01", { type: "income", accountId: "Bank", amountMinor: 12_500_000, categoryId: "salary" }),
    ev("n2", "2026-11-03", { type: "expense", accountId: "Card", amountMinor: 230_000, categoryId: "shopping" }),
    ev("n3", "2026-11-05", { type: "emi_payment", fromAccountId: "Bank", toAccountId: "Car loan", amountMinor: 900_000, interestMinor: 245_000, categoryId: "interest" }),
  ],
};
const ledger = buildLedger(book);
const today = "2026-11-25";
const name = (id: string) => id;
const MONTHS = ["2026-08", "2026-09", "2026-10", "2026-11"];
const months = monthlySummaries(book, ledger, "2026-11", 4, today);
const pointOf = (ym: string) => months.find((m) => m.ym === ym)!;

describe("figures for an earlier month agree with the rest of the dashboard", () => {
  it("the sample entries are all accepted", () => {
    expect(ledger.issues ?? []).toEqual([]);
  });

  for (const ym of MONTHS) {
    const end = ym === "2026-11" ? today : monthEnd(ym);
    const prevEnd = monthEnd(shiftMonth(ym, -1));

    it(`${ym}: net worth, assets and liabilities at the month's end match the net worth chart`, () => {
      const s = deriveState(book, ledger, end);
      const [p] = balanceSeries(book, ledger, [end]);
      expect(s.netWorthMinor).toBe(p.netWorthMinor);
      expect(s.assets.totalMinor).toBe(p.assetsMinor);
      expect(s.liabilities.totalMinor).toBe(p.liabilitiesMinor);
      expect(s.assets.totalMinor - s.liabilities.totalMinor).toBe(s.netWorthMinor);
    });

    it(`${ym}: spent, income and saved match the Spending card's bar and Earned & spent`, () => {
      const r = periodReport(book, ledger, monthStart(ym), monthEnd(ym));
      const m = pointOf(ym);
      expect(r.expensesMinor).toBe(m.expensesMinor);
      expect(r.incomeMinor).toBe(m.incomeMinor);
      expect(r.savingsMinor).toBe(m.savingsMinor);
      expect(r.incomeMinor - r.expensesMinor).toBe(r.savingsMinor);
    });

    it(`${ym}: the "how it adds up" sheets add up to the figures shown`, () => {
      const r = periodReport(book, ledger, monthStart(ym), monthEnd(ym));
      expect(explainSpent(book, ledger, monthStart(ym), monthEnd(ym), name).totalMinor).toBe(r.expensesMinor);
      expect(explainIncome(book, ledger, monthStart(ym), monthEnd(ym), name).totalMinor).toBe(r.incomeMinor);
      const change = deriveState(book, ledger, end).netWorthMinor - deriveState(book, ledger, prevEnd).netWorthMinor;
      expect(explainNetWorthChange(book, ledger, prevEnd, end, name).totalMinor).toBe(change);
    });
  }

  it("a finished month's spending change compares it with the whole month before, as the Spending card does", () => {
    for (const ym of ["2026-09", "2026-10"]) {
      const r = periodReport(book, ledger, monthStart(ym), monthEnd(ym));
      const before = periodReport(book, ledger, monthStart(shiftMonth(ym, -1)), monthEnd(shiftMonth(ym, -1)));
      const m = pointOf(ym);
      expect(changeBps(r.expensesMinor, before.expensesMinor)).toBe(changeBps(m.expensesMinor, m.comparableExpensesMinor));
    }
  });

  it("the months add up: each month's change chains into the next, and the spending sums to the whole period", () => {
    const start = deriveState(book, ledger, "2026-07-31").netWorthMinor;
    const changes = MONTHS.map((ym) => deriveState(book, ledger, ym === "2026-11" ? today : monthEnd(ym)).netWorthMinor - deriveState(book, ledger, monthEnd(shiftMonth(ym, -1))).netWorthMinor);
    expect(start + changes.reduce((a, b) => a + b, 0)).toBe(deriveState(book, ledger, today).netWorthMinor);
    const all = periodReport(book, ledger, "2026-08-01", today);
    const byMonth = MONTHS.map((ym) => periodReport(book, ledger, monthStart(ym), monthEnd(ym)));
    expect(byMonth.reduce((t, r) => t + r.expensesMinor, 0)).toBe(all.expensesMinor);
    expect(byMonth.reduce((t, r) => t + r.incomeMinor, 0)).toBe(all.incomeMinor);
  });
});
