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
    // A card paid beyond its recorded purchases is a bill from before your entries: not something you own.
    expect(own.find((l) => l.label === "Card")).toBeUndefined();
    expect(own.find((l) => l.label === "EY")).toMatchObject({ amountMinor: 565100, note: "Owes you" });
    expect(owe.map((l) => l.label)).toEqual(["Car loan", "Malu", "Other card"]);
  });
});

describe("shares in what you own", () => {
  it("are one line (with their names), not one per stock, and the total is unchanged", async () => {
    const { buildLedger } = await import("@/lib/finance/engine");
    const { deriveState } = await import("@/lib/finance/state");
    const { buildBreakdown } = await import("@/components/dashboard/net-worth-breakdown");
    const t = "2026-10-01T00:00:00Z";
    const acc = (id: string, type: string, open = 0, extra = {}) => ({ id, name: id, type, openingBalanceMinor: open, openedOn: "2026-01-01", createdAt: t, ...extra });
    const trade = (id: string, holdingId: string, qty: number, price: number) =>
      ({ id, date: "2026-10-02", createdAt: t, updatedAt: t, type: "trade", holdingId, side: "buy", quantity: qty, priceMinor: price, chargesMinor: 0, accountId: "Kotak Neo" });
    const book = {
      accounts: [acc("Kotak Neo", "bank", 10_000_000), acc("ITC", "investment", 0, { style: "delivery" }), acc("INFY", "investment", 0, { style: "delivery" }), acc("Fund", "investment", 500_000)],
      people: [],
      events: [trade("a", "ITC", 10, 40_000), trade("b", "INFY", 2, 150_000)],
    } as never;
    const state = deriveState(book, buildLedger(book), "2026-10-05");
    const { own } = buildBreakdown(state);
    const shares = own.find((l) => l.key === "shares")!;
    expect(shares.amountMinor).toBe(10 * 40_000 + 2 * 150_000);
    expect(shares.note).toContain("ITC");
    expect(shares.note).toContain("INFY");
    expect(own.some((l) => l.label === "ITC" || l.label === "INFY")).toBe(false);
    // A fund that isn't traded as shares keeps its own line.
    expect(own.some((l) => l.label === "Fund")).toBe(true);
    expect(own.reduce((t, l) => t + l.amountMinor, 0)).toBe(state.assets.totalMinor);
  });
});
