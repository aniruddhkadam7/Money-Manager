import { describe, expect, it } from "vitest";
import { accountActivity } from "@/lib/finance/account-activity";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const t = "2026-10-01T00:00:00Z";
const acc = (id: string, type: "bank" | "credit_card" | "loan" | "cash") => ({ id, name: id, type, openingBalanceMinor: 0, openedOn: "2026-01-01", createdAt: t });
const ev = (id: string, e: Partial<FinancialEvent> & { type: FinancialEvent["type"] }) => ({ id, date: "2026-10-05", createdAt: t, updatedAt: t, ...e }) as FinancialEvent;

const book: Book = {
  accounts: [acc("bank", "bank"), acc("card", "credit_card"), acc("loan", "loan"), acc("cash", "cash")],
  people: [{ id: "p", name: "Rahul", createdAt: t }],
  events: [
    ev("1", { type: "expense", accountId: "bank", amountMinor: 50000, categoryId: "food" }),
    ev("2", { type: "expense", accountId: "card", amountMinor: 20000, categoryId: "food" }),
    ev("3", { type: "transfer", fromAccountId: "bank", toAccountId: "card", amountMinor: 30000 }),
    ev("4", { type: "transfer", fromAccountId: "bank", toAccountId: "loan", amountMinor: 10000 }),
    ev("5", { type: "transfer", fromAccountId: "bank", toAccountId: "cash", amountMinor: 5000 }),
    ev("6", { type: "income", accountId: "bank", amountMinor: 900000, categoryId: "salary" }),
    ev("7", { type: "borrow", accountId: "bank", amountMinor: 600000, personId: "p" }),
    ev("8", { type: "split_expense", accountId: "card", totalMinor: 9000, categoryId: "food", shares: [{ personId: "p", amountMinor: 3000 }] }),
    ev("9", { type: "expense", accountId: "bank", amountMinor: 1, categoryId: "food", date: "2026-09-30" }),
  ],
};

describe("what happened in an account this month", () => {
  it("separates a bank's spending, the bills it paid and the money it received", () => {
    expect(accountActivity(book, "bank", "2026-10-01", "2026-10-31")).toEqual({ spentMinor: 50000, billsPaidMinor: 40000, receivedMinor: 1500000, paymentsInMinor: 0 });
  });

  it("counts a card's purchases as spent and the bill paid from the bank as a payment, not spending", () => {
    expect(accountActivity(book, "card", "2026-10-01", "2026-10-31")).toEqual({ spentMinor: 29000, billsPaidMinor: 0, receivedMinor: 0, paymentsInMinor: 30000 });
  });

  it("only counts the chosen dates", () => {
    expect(accountActivity(book, "bank", "2026-09-01", "2026-09-30").spentMinor).toBe(1);
  });
});
