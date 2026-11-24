import { describe, expect, it } from "vitest";
import { personDebts } from "@/lib/finance/debts";
import { buildLedger } from "@/lib/finance/engine";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const t = "2026-01-01T00:00:00Z";
const base = { createdAt: t, updatedAt: t };

describe("what you owe a person", () => {
  it("pays the oldest debt first, interest parts aside", () => {
    const events = [
      { ...base, id: "b1", type: "borrow", date: "2026-01-10", personId: "P", accountId: "B", amountMinor: 10_000_00 },
      { ...base, id: "b2", type: "borrow", date: "2026-02-10", personId: "P", accountId: "", amountMinor: 5_000_00, for: "service", categoryId: "maintenance" },
      { ...base, id: "r1", type: "repayment_made", date: "2026-03-01", personId: "P", accountId: "B", amountMinor: 12_500_00, interestMinor: 500_00, categoryId: "emi" },
    ] as FinancialEvent[];
    const d = personDebts(events, "P", "2026-03-10");
    expect(d.owedMinor).toBe(3_000_00);
    expect(d.debts).toEqual([expect.objectContaining({ eventId: "b2", for: "service", owedMinor: 3_000_00 })]);
  });

  it("finds the due date, the next instalment and simple interest so far", () => {
    const events = [
      {
        ...base,
        id: "b1",
        type: "borrow",
        date: "2026-01-01",
        personId: "P",
        accountId: "B",
        amountMinor: 60_000_00,
        terms: { dueDate: "2026-06-30", interest: { rateBps: 200, per: "month" }, instalments: { amountMinor: 10_000_00, firstDate: "2026-02-01" } },
      },
      { ...base, id: "r1", type: "repayment_made", date: "2026-02-01", personId: "P", accountId: "B", amountMinor: 10_000_00 },
    ] as FinancialEvent[];
    const d = personDebts(events, "P", "2026-03-03");
    expect(d.dueDate).toBe("2026-06-30");
    expect(d.nextInstalment).toEqual({ date: "2026-03-01", amountMinor: 10_000_00 });
    // ₹50,000 at 2% a month, for the month since the last payment: about ₹1,000.
    expect(d.interestSoFarMinor).toBeGreaterThan(950_00);
    expect(d.interestSoFarMinor).toBeLessThan(1_050_00);
    expect(d.suggestedMinor).toBe(10_000_00 + d.interestSoFarMinor);
  });

  it("a service on credit is spending, and owed; a repayment's interest is spending too", () => {
    const book = {
      accounts: [{ id: "B", name: "Bank", type: "bank", openingBalanceMinor: 50_000_00, openedOn: "2026-01-01", createdAt: t }],
      people: [{ id: "P", name: "Ravi", createdAt: t }],
      events: [
        { ...base, id: "s1", type: "borrow", date: "2026-01-05", personId: "P", accountId: "", amountMinor: 8_000_00, for: "service", categoryId: "maintenance" },
        { ...base, id: "r1", type: "repayment_made", date: "2026-01-20", personId: "P", accountId: "B", amountMinor: 8_300_00, interestMinor: 300_00, categoryId: "emi" },
      ],
    } as unknown as Book;
    const ledger = buildLedger(book);
    expect(ledger.issues).toEqual([]);
  });
});

describe("same-day order", () => {
  it("a debt counts before paying it back on the same day, whatever order they were entered", () => {
    const book = {
      accounts: [{ id: "B", name: "Bank", type: "bank", openingBalanceMinor: 50_000_00, openedOn: "2026-01-01", createdAt: t }],
      people: [{ id: "P", name: "Ravi", createdAt: t }],
      events: [
        { id: "r1", type: "repayment_made", date: "2026-02-01", personId: "P", accountId: "B", amountMinor: 5_000_00, predatesRecords: true, createdAt: "2026-02-01T00:00:00Z", updatedAt: t },
        { id: "b1", type: "borrow", date: "2026-02-01", personId: "P", accountId: "", amountMinor: 8_000_00, for: "service", categoryId: "other", createdAt: "2026-03-01T00:00:00Z", updatedAt: t },
      ],
    } as unknown as Book;
    const ledger = buildLedger(book);
    expect(ledger.issues).toEqual([]);
    const owed = ledger.entries.flatMap((e) => e.postings).filter((p) => p.ledger.includes("P")).reduce((s, p) => s + p.amountMinor, 0);
    expect(owed).toBe(-3_000_00);
  });
});

describe("money kept for someone", () => {
  it("came in, is theirs (not income), and is settled by handing it back", () => {
    const book = {
      accounts: [{ id: "B", name: "Bank", type: "bank", openingBalanceMinor: 0, openedOn: "2026-01-01", createdAt: t }],
      people: [{ id: "P", name: "Malu", createdAt: t }],
      events: [
        { ...base, id: "h1", type: "borrow", date: "2026-11-15", personId: "P", accountId: "B", amountMinor: 250_00, for: "held" },
        { ...base, id: "r1", type: "repayment_made", date: "2026-11-20", personId: "P", accountId: "B", amountMinor: 100_00 },
      ],
    } as unknown as Book;
    expect(buildLedger(book).issues).toEqual([]);
    const d = personDebts(book.events, "P", "2026-11-24");
    expect(d.owedMinor).toBe(150_00);
    expect(d.debts[0]).toMatchObject({ for: "held", owedMinor: 150_00 });
  });
});
