import { describe, expect, it } from "vitest";
import { buildLedger } from "@/lib/finance/engine";
import { moneyHealth, typicalMonths } from "@/lib/finance/health";
import { deriveState } from "@/lib/finance/state";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const t = "2026-07-01T00:00:00Z";
const acc = (id: string, type: "bank" | "cash" | "credit_card" | "loan", open = 0, extra: Record<string, unknown> = {}) => ({ id, name: id, type, openingBalanceMinor: open, openedOn: "2026-07-01", createdAt: t, ...extra });
const ev = (id: string, date: string, e: Record<string, unknown>) => ({ id, date, createdAt: t, updatedAt: t, ...e }) as unknown as FinancialEvent;
const L = (n: number) => n * 100; // rupees to paise

// Every month: ₹1,00,000 salary, ₹30,000 rent, ₹10,000 groceries, ₹10,000 car EMI (₹2,000 of it interest).
const monthOf = (ym: string, i: number) => [
  ev(`s${i}`, `${ym}-01`, { type: "income", accountId: "Bank", amountMinor: L(100_000), categoryId: "salary" }),
  ev(`r${i}`, `${ym}-03`, { type: "expense", accountId: "Bank", amountMinor: L(30_000), categoryId: "rent", description: "Rent to landlord" }),
  ev(`g${i}`, `${ym}-10`, { type: "expense", accountId: "Bank", amountMinor: L(10_000), categoryId: "groceries" }),
  ev(`e${i}`, `${ym}-05`, { type: "emi_payment", fromAccountId: "Bank", toAccountId: "Car loan", amountMinor: L(10_000), interestMinor: L(2_000), categoryId: "interest" }),
];

const book: Book = {
  accounts: [
    acc("Bank", "bank", L(50_000)),
    acc("Card", "credit_card", 0, { creditLimitMinor: L(100_000) }),
    acc("Car loan", "loan", L(300_000)),
  ],
  people: [{ id: "rahul", name: "Rahul", createdAt: t }],
  events: [
    ...["2026-07", "2026-08", "2026-09", "2026-10"].flatMap((ym, i) => monthOf(ym, i)),
    ev("c1", "2026-10-20", { type: "expense", accountId: "Card", amountMinor: L(20_000), categoryId: "shopping" }),
    ev("l1", "2026-10-22", { type: "lend", personId: "rahul", accountId: "Bank", amountMinor: L(15_000) }),
  ],
};
const ledger = buildLedger(book);

describe("money health", () => {
  it("averages over the last three complete months", () => {
    expect(typicalMonths("2026-10-31", "2026-07-01")).toEqual(["2026-08", "2026-09", "2026-10"]);
    // Mid-month: the month in progress isn't typical yet.
    expect(typicalMonths("2026-10-15", "2026-07-01")).toEqual(["2026-07", "2026-08", "2026-09"]);
    // Started recently: only the months with entries.
    expect(typicalMonths("2026-10-31", "2026-09-12")).toEqual(["2026-09", "2026-10"]);
  });

  const h = moneyHealth(book, ledger, "2026-10-31");
  const s = deriveState(book, ledger, "2026-10-31");

  it("runway: bank and cash less card dues ÷ typical spending plus the EMIs' loan repayment", () => {
    // Spending per month: rent + groceries + the EMI's interest = ₹42,000 (October also ₹20,000 on the card).
    expect(h.runway.liquidMinor).toBe(s.cashMinor);
    expect(h.runway.cardDuesMinor).toBe(L(20_000));
    // Less card dues and what's owed to people (none here).
    expect(h.runway.availableMinor).toBe(s.cashMinor - L(20_000) - s.liabilities.borrowedMinor);
    expect(h.runway.avgSpentMinor).toBe(Math.round((L(42_000) * 3 + L(20_000)) / 3));
    // ₹10,000 EMI, ₹2,000 of it interest (already spending): ₹8,000 repays the loan.
    expect(h.runway.avgEmiPrincipalMinor).toBe(L(8_000));
    expect(h.runway.monthlyNeedMinor).toBe(h.runway.avgSpentMinor + L(8_000));
    expect(h.runway.months).toBe(Math.round((h.runway.availableMinor / h.runway.monthlyNeedMinor) * 10) / 10);
  });

  it("savings rate: the month's, and the typical months'", () => {
    expect(h.savings.incomeMinor).toBe(L(100_000));
    expect(h.savings.spentMinor).toBe(L(62_000));
    expect(h.savings.bps).toBe(3800);
    expect(h.savings.avgBps).toBe(Math.round(((L(100_000) * 3 - L(42_000) * 3 - L(20_000)) / (L(100_000) * 3)) * 10_000));
    expect(h.savings.tone).toBe("good");
  });

  it("EMIs and fixed costs against income", () => {
    expect(h.emi.avgEmiMinor).toBe(L(10_000));
    expect(h.emi.bps).toBe(1000);
    expect(h.emi.tone).toBe("good");
    // Nothing listed: nothing is guessed, so fixed costs are the EMIs alone.
    expect(h.fixed.emiMinor).toBe(L(10_000));
    expect(h.fixed.recurringMinor).toBe(0);
    expect(h.fixed.totalMinor).toBe(L(10_000));
    expect(h.fixed.bps).toBe(1000);
  });

  it("fixed costs are the ones you list (each at its monthly amount), plus EMIs", () => {
    const listed = [
      { id: "rent", name: "Rent", amountMinor: L(30_000), repeat: "monthly", monthlyMinor: L(30_000) },
      { id: "ins", name: "Insurance", amountMinor: L(24_000), repeat: "yearly", monthlyMinor: L(2_000) },
    ];
    const withList = moneyHealth(book, ledger, "2026-10-31", [], listed);
    expect(withList.fixed.recurringMinor).toBe(L(32_000));
    expect(withList.fixed.totalMinor).toBe(L(42_000));
    expect(withList.fixed.bps).toBe(4200);
    expect(withList.detail.fixedCosts.map((c) => c.name)).toEqual(["Rent", "Insurance"]);
    // Nothing else moves.
    expect(withList.runway).toEqual(h.runway);
  });

  it("debt, card usage and money owed to you, from the balance sheet", () => {
    expect(h.debt.liabilitiesMinor).toBe(s.liabilities.totalMinor);
    expect(h.debt.bps).toBe(Math.round((s.liabilities.totalMinor / s.assets.totalMinor) * 10_000));
    expect(h.cards).toMatchObject({ duesMinor: L(20_000), limitMinor: L(100_000), bps: 2000, tone: "good" });
    expect(h.owed.owedMinor).toBe(L(15_000));
    expect(h.owed.bps).toBe(Math.round((L(15_000) / s.assets.totalMinor) * 10_000));
  });

  it("net worth growth over 1 and 3 months, nothing before records began", () => {
    const nw = (d: string) => deriveState(book, ledger, d).netWorthMinor;
    expect(h.growth.netWorthMinor).toBe(nw("2026-10-31"));
    expect(h.growth.m1).toBe(nw("2026-10-31") - nw("2026-09-30"));
    expect(h.growth.m3).toBe(nw("2026-10-31") - nw("2026-07-31"));
    expect(h.growth.m12).toBeNull();
  });

  it("with no cards or income, says so rather than inventing a ratio", () => {
    const empty = buildLedger({ accounts: [acc("Bank", "bank", L(1_000))], people: [], events: [] });
    const e = moneyHealth({ accounts: [acc("Bank", "bank", L(1_000))], people: [], events: [] }, empty, "2026-10-31");
    expect(e.cards.bps).toBeNull();
    expect(e.cards.tone).toBe("none");
    expect(e.emi.bps).toBeNull();
    expect(e.savings.bps).toBeNull();
  });
});

describe("a fixed cost's monthly amount", () => {
  it("spreads a quarterly or yearly payment over the months", async () => {
    const { monthlyOf } = await import("@/lib/fixed-costs");
    expect(monthlyOf({ amountMinor: 1_200_000, repeat: "monthly" })).toBe(1_200_000);
    expect(monthlyOf({ amountMinor: 1_200_000, repeat: "quarterly" })).toBe(400_000);
    expect(monthlyOf({ amountMinor: 1_200_000, repeat: "yearly" })).toBe(100_000);
  });
});
