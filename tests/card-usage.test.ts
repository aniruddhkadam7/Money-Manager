import { describe, expect, it } from "vitest";
import { cardStatementBills, cardUsage } from "@/lib/finance/card-bill-status";
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

describe("card statement bills", () => {
  // Three months' statements whose printed statement date was misread as the same day, outside every period.
  const imports = [
    { accountId: "card", status: "IMPORTED", periodStart: "2026-09-25", periodEnd: "2026-10-25", cardBill: { statementDate: "2026-09-01", dueDate: "2026-11-12", totalDueMinor: 271_537 } },
    { accountId: "card", status: "IMPORTED", periodStart: "2026-07-31", periodEnd: "2026-08-25", cardBill: { statementDate: "2026-09-01", dueDate: "2026-09-12", totalDueMinor: 1_377_611 } },
    { accountId: "card", status: "IMPORTED", periodStart: "2026-08-26", periodEnd: "2026-09-23", cardBill: { statementDate: "2026-09-01", dueDate: "2026-10-13", totalDueMinor: 340_896 } },
    { accountId: "other", status: "IMPORTED", periodEnd: "2026-10-25", cardBill: { totalDueMinor: 1 } },
  ];

  it("dates a statement by its period's last day when the printed date falls outside the period", () => {
    expect(cardStatementBills(imports, "card").map((b) => b.statementDate)).toEqual(["2026-10-25", "2026-08-25", "2026-09-23"]);
  });

  it("keeps a printed date on or just after the period's last day", () => {
    const bills = cardStatementBills([{ accountId: "card", periodStart: "2026-09-25", periodEnd: "2026-10-25", cardBill: { statementDate: "2026-10-27", totalDueMinor: 5 } }], "card");
    expect(bills[0].statementDate).toBe("2026-10-27");
  });

  it("so the latest bill, unpaid since its statement, is what's taken from the limit", () => {
    const b = book([
      { type: "transfer", date: "2026-09-11", fromAccountId: "bank", toAccountId: "card", amountMinor: 1_377_611 },
      { type: "transfer", date: "2026-10-07", fromAccountId: "bank", toAccountId: "card", amountMinor: 340_896 },
      { type: "expense", date: "2026-10-20", accountId: "card", amountMinor: 10_000 }, // on the October bill already
    ]);
    expect(cardUsage(b, "card", cardStatementBills(imports, "card"), 0)).toMatchObject({ usedMinor: 271_537, dueMinor: 271_537, dueDate: "2026-11-12" });
  });
});
