import { describe, expect, it } from "vitest";
import { cardUsage } from "@/lib/finance/card-bill-status";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const base = { createdAt: "x", updatedAt: "x" };
const book = (events: Partial<FinancialEvent>[]) => ({ accounts: [], people: [], events: events.map((e, i) => ({ id: `e${i}`, ...base, ...e })) }) as unknown as Book;
const bill = { statementDate: "2026-10-10", dueDate: "2026-10-30", totalDueMinor: 1_000_000 };

describe("card usage", () => {
  it("is the unpaid bill plus spending after the statement, and says what's still due by when", () => {
    const b = book([
      { type: "expense", date: "2026-10-05", accountId: "card", amountMinor: 999 }, // on the bill already
      { type: "expense", date: "2026-10-12", accountId: "card", amountMinor: 200_000 },
      { type: "income", date: "2026-10-13", accountId: "card", amountMinor: 50_000 }, // a refund
      { type: "transfer", date: "2026-10-15", fromAccountId: "bank", toAccountId: "card", amountMinor: 400_000 },
    ]);
    expect(cardUsage(b, "card", [bill], 0)).toEqual({ usedMinor: 750_000, dueMinor: 600_000, dueDate: "2026-10-30", unbilledMinor: 150_000 });
  });

  it("counts a payment beyond the bill against the new spending, never below nothing used", () => {
    const b = book([
      { type: "expense", date: "2026-10-12", accountId: "card", amountMinor: 100_000 },
      { type: "transfer", date: "2026-10-15", fromAccountId: "bank", toAccountId: "card", amountMinor: 1_500_000 },
    ]);
    expect(cardUsage(b, "card", [bill], 0)).toMatchObject({ usedMinor: 0, dueMinor: 0 });
  });

  it("falls back to what the entries say is owed when no statement printed a bill", () => {
    expect(cardUsage(book([]), "card", [{}], 250_000)).toMatchObject({ usedMinor: 250_000, dueMinor: 0 });
  });
});
