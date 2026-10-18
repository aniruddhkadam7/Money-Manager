import { describe, expect, it } from "vitest";
import { buildLedger } from "@/lib/finance/engine";
import { explainAccountBalance, explainIncome, explainNetWorthChange, explainSpent } from "@/lib/finance/explain";
import { deriveState, periodReport } from "@/lib/finance/state";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const t = "2026-09-01T00:00:00Z";
const acc = (id: string, type: "bank" | "credit_card" | "loan" | "investment", open = 0, openedOn = "2026-01-01") => ({ id, name: id, type, openingBalanceMinor: open, openedOn, createdAt: t });
const ev = (id: string, date: string, e: Record<string, unknown>) => ({ id, date, createdAt: t, updatedAt: t, ...e }) as unknown as FinancialEvent;

const book: Book = {
  accounts: [acc("Kotak", "bank", 2000000), acc("Card", "credit_card", 50000), acc("Car loan", "loan", 30000000, "2026-10-03"), acc("Fund", "investment")],
  people: [{ id: "g", name: "Govindraj", createdAt: t }, { id: "ey", name: "EY", createdAt: t }],
  events: [
    ev("s", "2026-09-30", { type: "income", accountId: "Kotak", amountMinor: 999, categoryId: "salary" }),
    ev("cb", "2026-10-12", { type: "income", accountId: "Kotak", amountMinor: 10_086, categoryId: "refund", description: "Cashback from bank" }),
    ev("1", "2026-10-01", { type: "income", accountId: "Kotak", amountMinor: 4480600, categoryId: "salary" }),
    ev("2", "2026-10-02", { type: "expense", accountId: "Kotak", amountMinor: 120000, categoryId: "food" }),
    ev("3", "2026-10-02", { type: "expense", accountId: "Card", amountMinor: 30000, categoryId: "shopping", description: "Amazon" }),
    ev("4", "2026-10-04", { type: "income", accountId: "Card", amountMinor: 10000, categoryId: "refund", description: "Amazon" }),
    ev("5", "2026-10-05", { type: "transfer", fromAccountId: "Kotak", toAccountId: "Card", amountMinor: 70000 }),
    ev("6", "2026-10-05", { type: "borrow", personId: "g", accountId: "Kotak", amountMinor: 8256100, predatesRecords: true }),
    ev("7", "2026-10-06", { type: "reimbursable_expense", accountId: "Kotak", amountMinor: 136700, categoryId: "travel", personId: "ey" }),
    ev("8", "2026-10-07", { type: "invest", fromAccountId: "Kotak", holdingId: "Fund", amountMinor: 100000 }),
    ev("9", "2026-10-08", { type: "update_valuation", holdingId: "Fund", valueMinor: 112000 }),
    ev("a", "2026-10-08", { type: "income", accountId: "Kotak", amountMinor: 5000, categoryId: "refund" }),
    ev("b", "2026-10-09", { type: "repayment_made", personId: "ey", accountId: "Kotak", amountMinor: 500000, predatesRecords: true }),
  ],
};
const ledger = buildLedger(book);
const name = (id: string) => id;
const sum = (ls: { amountMinor: number }[]) => ls.reduce((s, l) => s + l.amountMinor, 0);

describe("how the dashboard's numbers add up", () => {
  it("explains the month's net worth change exactly, starting balances and old debts included", () => {
    const x = explainNetWorthChange(book, ledger, "2026-09-30", "2026-10-31", name);
    const change = deriveState(book, ledger, "2026-10-31").netWorthMinor - deriveState(book, ledger, "2026-09-30").netWorthMinor;
    expect(x.totalMinor).toBe(change);
    for (const g of x.groups) expect(sum(g.lines)).toBe(g.amountMinor);
    expect(x.groups.find((g) => g.label === "Starting balances & old debts")!.lines.map((l) => l.label)).toEqual(["Car loan: starting balance", "Govindraj: owed from before tracking", "Paid back EY (debt from before tracking)"]);
    expect(x.groups.find((g) => g.label === "Investments")!.amountMinor).toBe(12000);
  });

  it("explains Spent and Income exactly as the month's report counts them", () => {
    const r = periodReport(book, ledger, "2026-10-01", "2026-10-31");
    const spent = explainSpent(book, ledger, "2026-10-01", "2026-10-31", name);
    expect(spent.totalMinor).toBe(r.expensesMinor);
    expect(sum(spent.lines)).toBe(r.expensesMinor);
    // A refund with no matching purchase is listed on its own, named and dated, not lumped together.
    expect(spent.lines.find((l) => l.label === "refund from Cashback from bank")).toMatchObject({ amountMinor: -10_086, entry: { categoryId: "refund", date: "2026-10-12" } });
    expect(spent.lines.some((l) => l.label === "Other refunds")).toBe(false);
    const income = explainIncome(book, ledger, "2026-10-01", "2026-10-31", name);
    expect(sum(income.lines)).toBe(r.incomeMinor);
    expect(income.savedMinor).toBe(r.incomeMinor - r.expensesMinor);
  });

  it("explains each account's balance from its starting balance and every move", () => {
    const state = deriveState(book, ledger, "2026-10-31");
    for (const id of ["Kotak", "Card", "Car loan", "Fund"]) {
      const x = explainAccountBalance(book, ledger, id, "2026-10-31");
      expect(x.totalMinor + 0).toBe(state.accounts.find((a) => a.account.id === id)!.balanceMinor + 0);
      expect(x.startMinor + sum(x.lines) + 0).toBe(x.totalMinor + 0);
    }
    const card = explainAccountBalance(book, ledger, "Card", "2026-10-31");
    expect(card.lines.map((l) => l.label).sort()).toEqual(["Payments & refunds", "Purchases & charges"]);
  });
});

describe("a refund from a shop you bought from", () => {
  it("comes off that purchase's category, however the bank wrote the names, even printed a day before it", () => {
    const b: Book = {
      accounts: [acc("Card", "credit_card")],
      people: [],
      events: [
        ev("sub", "2026-10-14", { type: "expense", accountId: "Card", amountMinor: 209_986, categoryId: "subscriptions", description: "GITHUB, INC." }),
        ev("back", "2026-10-13", { type: "income", accountId: "Card", amountMinor: 10_086, categoryId: "refund", description: "Markup reversal GitHub" }),
      ],
    };
    const r = periodReport(b, buildLedger(b), "2026-10-01", "2026-10-31");
    expect(r.expensesByCategory).toEqual([{ categoryId: "subscriptions", amountMinor: 209_986 - 10_086 }]);
    const spent = explainSpent(b, buildLedger(b), "2026-10-01", "2026-10-31", (id) => id);
    expect(spent.lines).toEqual([{ label: "subscriptions", amountMinor: 199_900 }]);
  });
});
