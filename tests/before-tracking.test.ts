import { describe, expect, it } from "vitest";
import { accountActivity } from "@/lib/finance/account-activity";
import { buildLedger } from "@/lib/finance/engine";
import { deriveState } from "@/lib/finance/state";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const t = "2026-10-01T00:00:00Z";
const bank = { id: "kotak", name: "Kotak", type: "bank" as const, openingBalanceMinor: 2944631, openedOn: "2026-01-01", createdAt: t };
const ev = (id: string, e: Record<string, unknown>) => ({ id, date: "2026-07-01", createdAt: t, updatedAt: t, ...e }) as unknown as FinancialEvent;
const people = [{ id: "g", name: "Govindraj", createdAt: t }, { id: "s", name: "Sneha", createdAt: t }];
const stateOf = (events: FinancialEvent[]) => {
  const book: Book = { accounts: [bank], people, events };
  return { book, state: deriveState(book, buildLedger(book), "2026-10-31") };
};

describe("debts from before you started tracking", () => {
  it("a borrowing from before counts as owed but adds no money to the bank", () => {
    const { state } = stateOf([ev("b", { type: "borrow", personId: "g", accountId: "kotak", amountMinor: 8256100, predatesRecords: true })]);
    expect(state.accounts[0].balanceMinor).toBe(2944631);
    expect(state.liabilities.borrowedMinor).toBe(8256100);
    expect(state.netWorthMinor).toBe(2944631 - 8256100);
  });

  it("an ordinary borrowing still arrives in the bank, leaving net worth unchanged", () => {
    const { state } = stateOf([ev("b", { type: "borrow", personId: "g", accountId: "kotak", amountMinor: 600000 })]);
    expect(state.accounts[0].balanceMinor).toBe(2944631 + 600000);
    expect(state.netWorthMinor).toBe(2944631);
  });

  it("a loan you gave before counts as owed to you without leaving the bank", () => {
    const { state } = stateOf([ev("l", { type: "lend", personId: "s", accountId: "kotak", amountMinor: 100000, predatesRecords: true })]);
    expect(state.accounts[0].balanceMinor).toBe(2944631);
    expect(state.assets.receivablesMinor).toBe(100000);
    expect(state.netWorthMinor).toBe(2944631 + 100000);
  });

  it("can be repaid later from the bank, settling the debt", () => {
    const { state } = stateOf([
      ev("b", { type: "borrow", personId: "g", accountId: "kotak", amountMinor: 500000, predatesRecords: true }),
      ev("r", { type: "repayment_made", personId: "g", accountId: "kotak", amountMinor: 500000, date: "2026-10-07" }),
    ]);
    expect(state.people.find((p) => p.person.id === "g")!.iOwe.outstandingMinor + 0).toBe(0);
    expect(state.accounts[0].balanceMinor).toBe(2944631 - 500000);
  });

  it("isn't counted as money received in the account's month", () => {
    const { book } = stateOf([ev("b", { type: "borrow", personId: "g", accountId: "kotak", amountMinor: 500000, predatesRecords: true })]);
    expect(accountActivity(book, "kotak", "2026-07-01", "2026-07-31").receivedMinor).toBe(0);
  });
});
