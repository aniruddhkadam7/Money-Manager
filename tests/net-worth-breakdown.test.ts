import { describe, expect, it } from "vitest";
import { buildBreakdown } from "@/components/dashboard/net-worth-breakdown";
import { buildLedger } from "@/lib/finance/engine";
import { deriveState } from "@/lib/finance/state";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const t = "2026-10-01T00:00:00Z";
const acc = (id: string, type: "bank" | "credit_card" | "loan" | "cash" | "investment", open = 0) => ({ id, name: id, type, openingBalanceMinor: open, openedOn: "2026-01-01", createdAt: t });
const ev = (id: string, e: Record<string, unknown>) => ({ id, date: "2026-10-05", createdAt: t, updatedAt: t, ...e }) as unknown as FinancialEvent;

describe("net worth breakdown", () => {
  it("lists every item and adds up exactly to the headline", () => {
    const book: Book = {
      accounts: [acc("Kotak", "bank", 2943131), acc("Card", "credit_card"), acc("Other card", "credit_card", 50000), acc("Car loan", "loan", 30000000), acc("Fund", "investment"), acc("Cash", "cash", 1000)],
      people: [{ id: "ey", name: "EY", createdAt: t }, { id: "malu", name: "Malu", createdAt: t }],
      events: [
        ev("1", { type: "transfer", fromAccountId: "Kotak", toAccountId: "Card", amountMinor: 3000 }),
        ev("2", { type: "reimbursable_expense", accountId: "Kotak", amountMinor: 565100, categoryId: "travel", personId: "ey" }),
        ev("3", { type: "borrow", accountId: "Kotak", amountMinor: 1500000, personId: "malu" }),
        ev("4", { type: "invest", fromAccountId: "Kotak", holdingId: "Fund", amountMinor: 100000 }),
      ],
    };
    const state = deriveState(book, buildLedger(book), "2026-10-31");
    const { own, owe } = buildBreakdown(state);
    const sum = (ls: { amountMinor: number }[]) => ls.reduce((s, l) => s + l.amountMinor, 0);
    expect(sum(own)).toBe(state.assets.totalMinor);
    expect(sum(owe)).toBe(state.liabilities.totalMinor);
    expect(sum(own) - sum(owe)).toBe(state.netWorthMinor);
    expect(own.find((l) => l.label === "Card")).toMatchObject({ amountMinor: 3000, note: "Paid more than recorded spending" });
    expect(own.find((l) => l.label === "EY")).toMatchObject({ amountMinor: 565100, note: "Owes you" });
    expect(owe.map((l) => l.label)).toEqual(["Car loan", "Malu", "Other card"]);
  });
});
