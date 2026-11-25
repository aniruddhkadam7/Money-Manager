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

  it("works days before the statement back from it, not from entries alone (no made-up negative balance)", () => {
    const gaps = anchorGaps(book, ledger, anchors);
    // 15 Oct: nothing recorded between then and the statement, so the bank held what the statement closed at.
    const before = applyAnchorGaps(deriveState(book, ledger, "2026-10-15"), gaps);
    expect(before.accounts.find((a) => a.account.id === "Kotak")?.balanceMinor).toBe(940674);
    // 9 Oct: before the ₹818.26 spent on the 10th, so that much more.
    const earlier = applyAnchorGaps(deriveState(book, ledger, "2026-10-09"), gaps);
    expect(earlier.accounts.find((a) => a.account.id === "Kotak")?.balanceMinor).toBe(940674 + 81826);

    // The chart says the same, with no jump on the statement's day.
    const [p9, p15, p16] = applyAnchorGapsToSeries(balanceSeries(book, ledger, ["2026-10-09", "2026-10-15", "2026-10-16"]), gaps);
    expect(p9.netWorthMinor).toBe(5000000 + 940674 + 81826);
    expect(p15.netWorthMinor).toBe(5000000 + 940674);
    expect(p16.netWorthMinor).toBe(5000000 + 940674);
    expect(p15.netWorthMinor).toBe(before.netWorthMinor);
  });

  it("with several statements, each day goes by the latest one up to it (or the first one, before any)", () => {
    // Statements closing 16 Oct (₹9,406.74) and 31 Oct (₹1,000, which the entries miss ₹8,000 of on top of the rest).
    const gaps = anchorGaps(book, ledger, [...anchors, { accountId: "Kotak", date: "2026-10-31", closingMinor: 100000 }], true);
    const kotak = (date: string) => applyAnchorGaps(deriveState(book, ledger, date), gaps).accounts.find((a) => a.account.id === "Kotak")?.balanceMinor;
    expect(kotak("2026-10-05")).toBe(940674 + 81826);
    expect(kotak("2026-10-16")).toBe(940674);
    expect(kotak("2026-10-20")).toBe(940674 - 50000);
    expect(kotak("2026-10-31")).toBe(100000);
    expect(kotak("2026-11-02")).toBe(100000);
  });

  it("a statement that agrees with the entries still settles the days around it", () => {
    const agreeing = anchorGaps(book, ledger, [{ accountId: "Kotak", date: "2026-10-12", closingMinor: -81826 }, ...anchors], true);
    // 12 Oct: the entries match that statement; the later statement's gap mustn't leak back past it.
    expect(applyAnchorGaps(deriveState(book, ledger, "2026-10-13"), agreeing).accounts.find((a) => a.account.id === "Kotak")?.balanceMinor).toBe(-81826);
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
