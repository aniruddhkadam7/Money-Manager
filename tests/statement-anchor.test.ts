import { describe, expect, it } from "vitest";
import { buildLedger } from "@/lib/finance/engine";
import { balanceSeries } from "@/lib/finance/series";
import { deriveState } from "@/lib/finance/state";
import { anchorGaps, applyAnchorGaps, applyAnchorGapsToSeries, statementClosing } from "@/lib/finance/statement-anchor";
import type { ImportRecord } from "@/lib/statements/types";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const t = "2026-10-01T00:00:00Z";
const acc = (id: string, type: "bank" | "credit_card" | "cash", open = 0) => ({ id, name: id, type, openingBalanceMinor: open, openedOn: "2026-01-01", createdAt: t });
const ev = (id: string, date: string, e: Record<string, unknown>) => ({ id, date, createdAt: t, updatedAt: t, ...e }) as unknown as FinancialEvent;

// Kotak's entries add up to −₹818.26 while its statement of 16 Oct closed at ₹9,406.74; ICICI holds ₹50,000.
const book: Book = {
  accounts: [acc("Kotak", "bank"), acc("ICICI", "bank", 5000000), acc("Card", "credit_card")],
  people: [],
  events: [
    ev("1", "2026-10-10", { type: "expense", accountId: "Kotak", amountMinor: 81826, categoryId: "food" }),
    ev("2", "2026-10-17", { type: "expense", accountId: "Kotak", amountMinor: 50000, categoryId: "food" }),
  ],
};
const ledger = buildLedger(book);
const anchors = [
  { accountId: "Kotak", date: "2026-10-16", closingMinor: 940674 },
  // A card's statement doesn't set a bank balance.
  { accountId: "Card", date: "2026-10-16", closingMinor: 123 },
];

describe("balances from the latest bank statement", () => {
  it("starts the account from the statement's closing balance and adds what's recorded after it", () => {
    const gaps = anchorGaps(book, ledger, anchors);
    expect(gaps).toEqual([{ accountId: "Kotak", date: "2026-10-16", gapMinor: 940674 + 81826 }]);

    const state = applyAnchorGaps(deriveState(book, ledger, "2026-10-17"), gaps);
    expect(state.accounts.find((a) => a.account.id === "Kotak")?.balanceMinor).toBe(940674 - 50000);
    // Bank & cash, assets and net worth are the sums of those same balances.
    expect(state.cashMinor).toBe(940674 - 50000 + 5000000);
    expect(state.assets.cashMinor).toBe(state.cashMinor);
    expect(state.assets.totalMinor).toBe(state.cashMinor);
    expect(state.netWorthMinor).toBe(state.cashMinor);
  });

  it("leaves days before the statement as recorded", () => {
    const gaps = anchorGaps(book, ledger, anchors);
    const before = deriveState(book, ledger, "2026-10-15");
    expect(applyAnchorGaps(before, gaps)).toBe(before);

    const [p15, p16] = applyAnchorGapsToSeries(balanceSeries(book, ledger, ["2026-10-15", "2026-10-16"]), gaps);
    expect(p15.netWorthMinor).toBe(5000000 - 81826);
    expect(p16.netWorthMinor).toBe(5000000 + 940674);
  });

  it("counts entries marked as not in a statement on top of the statement's balance", () => {
    const withOff: Book = {
      ...book,
      events: [
        ...book.events,
        // Before and after the statement's day: the bank shows neither.
        ev("3", "2026-10-12", { type: "expense", accountId: "Kotak", amountMinor: 10000, categoryId: "food", offStatement: true }),
        ev("4", "2026-10-17", { type: "expense", accountId: "Kotak", amountMinor: 20000, categoryId: "food", offStatement: true }),
      ],
    };
    const l = buildLedger(withOff);
    const gaps = anchorGaps(withOff, l, anchors);
    expect(gaps).toEqual([{ accountId: "Kotak", date: "2026-10-16", gapMinor: 940674 + 81826 }]);
    const state = applyAnchorGaps(deriveState(withOff, l, "2026-10-17"), gaps);
    expect(state.accounts.find((a) => a.account.id === "Kotak")?.balanceMinor).toBe(940674 - 50000 - 10000 - 20000);
  });

  it("changes nothing when the entries already match the statement", () => {
    expect(anchorGaps(book, ledger, [{ accountId: "Kotak", date: "2026-10-16", closingMinor: -81826 }])).toEqual([]);
  });
});

describe("a statement's closing balance", () => {
  const record = (over: Partial<ImportRecord>) => ({ reconciliation: { actualClosingMinor: 4989773 }, ...over }) as ImportRecord;

  it("uses the printed closing balance", () => {
    expect(statementClosing(record({ closingBalanceMinor: 100 }), "bank")).toBe(100);
  });

  it("takes the last line's balance when a bank statement prints no closing balance (ICICI)", () => {
    expect(statementClosing(record({}), "bank")).toBe(4989773);
  });

  it("doesn't read a card statement's amount due as a closing balance", () => {
    expect(statementClosing(record({}), "credit_card")).toBeUndefined();
  });
});
