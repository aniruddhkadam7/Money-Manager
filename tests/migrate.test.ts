import { describe, expect, it } from "vitest";
import { buildLedger } from "@/lib/finance/engine";
import {
  bookFromLegacyExpenses,
  defaultAccounts,
  DEFAULT_ACCOUNT_ID,
  DEFAULTS_VERSION,
  missingDefaultAccounts,
  restoreDefaultAccounts,
  withDefaultAccounts,
} from "@/lib/finance/migrate";
import { deriveState } from "@/lib/finance/state";
import type { Book } from "@/lib/finance/types";

const NOW = "2026-10-05T00:00:00.000Z";
const SIX = ["Cash", "UPI", "Debit card", "Credit card", "Net banking", "Wallet"];
const names = (b: Book) => b.accounts.map((a) => a.name);
const all = defaultAccounts(NOW);
const cashOnly = (): Book => ({ accounts: [all[0]], people: [], events: [] });
/** What someone who already received the first four accounts has stored. */
const version1 = (): Book => ({ accounts: all.slice(0, 4), people: [], events: [], setup: { defaultAccountsAdded: true } });

describe("the fixed set of everyday accounts", () => {
  it("is Cash, UPI, Debit card, Credit card, Net banking and Wallet, all empty", () => {
    expect(all.map((a) => a.name)).toEqual(SIX);
    expect(all.map((a) => a.type)).toEqual(["cash", "bank", "bank", "credit_card", "bank", "cash"]);
    expect(all.every((a) => a.openingBalanceMinor === 0)).toBe(true);
    expect(new Set(all.map((a) => a.id)).size).toBe(6);
  });

  it("a brand-new or migrated book starts with all six", () => {
    const book = bookFromLegacyExpenses([], NOW);
    expect(names(book)).toEqual(SIX);
    expect(book.setup).toEqual({ defaultAccountsAdded: true, defaultsVersion: DEFAULTS_VERSION });
  });

  it("old expenses still land in Cash and keep their totals", () => {
    const book = bookFromLegacyExpenses(
      [{ id: "e1", amountMinor: 85_000, description: "Swiggy", categoryId: "food", date: "2026-10-02", createdAt: NOW, updatedAt: NOW }],
      NOW,
    );
    expect(book.events[0]).toMatchObject({ type: "expense", accountId: DEFAULT_ACCOUNT_ID, amountMinor: 85_000 });
    expect(deriveState(book, buildLedger(book), "2026-10-05").cashMinor).toBe(-85_000);
  });
});

describe("one-time updates for people who already have data", () => {
  it("someone with only the starter Cash account gets the whole set", () => {
    const upgraded = withDefaultAccounts(cashOnly(), NOW);
    expect(names(upgraded)).toEqual(SIX);
    expect(withDefaultAccounts(upgraded, NOW)).toBe(upgraded); // second run changes nothing
  });

  it("someone who got the first four gets just Net banking and Wallet, once", () => {
    const upgraded = withDefaultAccounts(version1(), NOW);
    expect(names(upgraded)).toEqual(SIX);
    expect(upgraded.setup?.defaultsVersion).toBe(DEFAULTS_VERSION);
    expect(withDefaultAccounts(upgraded, NOW)).toBe(upgraded);
  });

  it("never re-adds an old standard account they deleted (UPI), but does add the two new ones", () => {
    const book = version1();
    const withoutUpi: Book = { ...book, accounts: book.accounts.filter((a) => a.name !== "UPI") };
    expect(names(withDefaultAccounts(withoutUpi, NOW))).toEqual(["Cash", "Debit card", "Credit card", "Net banking", "Wallet"]);
  });

  it("keeps existing entries and balances untouched", () => {
    const book: Book = {
      ...version1(),
      events: [{ type: "expense", id: "x", date: "2026-10-01", accountId: DEFAULT_ACCOUNT_ID, amountMinor: 5_000, categoryId: "food", createdAt: NOW, updatedAt: NOW }],
    };
    const upgraded = withDefaultAccounts(book, NOW);
    expect(upgraded.events).toEqual(book.events);
    expect(deriveState(upgraded, buildLedger(upgraded), "2026-10-05").netWorthMinor).toBe(-5_000);
  });

  it("leaves people who set up their own accounts alone", () => {
    const own: Book = {
      accounts: [all[0], { id: "hdfc", name: "HDFC", type: "bank", openingBalanceMinor: 100_000, openedOn: "2026-01-01", createdAt: NOW }],
      people: [],
      events: [],
    };
    const result = withDefaultAccounts(own, NOW);
    expect(names(result)).toEqual(["Cash", "HDFC"]);
    expect(result.setup?.defaultsVersion).toBe(DEFAULTS_VERSION);
  });

  it("an empty book gets the full set", () => {
    expect(names(withDefaultAccounts({ accounts: [], people: [], events: [] }, NOW))).toEqual(SIX);
  });
});

describe("restoring the standard accounts", () => {
  it("reports which are missing and puts only those back, leaving everything else alone", () => {
    const mine: Book = {
      accounts: [
        all[0],
        { id: "hdfc", name: "HDFC", type: "bank", openingBalanceMinor: 100_000, openedOn: "2026-01-01", createdAt: NOW },
      ],
      people: [],
      events: [],
      setup: { defaultAccountsAdded: true, defaultsVersion: DEFAULTS_VERSION },
    };
    expect(missingDefaultAccounts(mine, NOW).map((a) => a.name)).toEqual(["UPI", "Debit card", "Credit card", "Net banking", "Wallet"]);
    const restored = restoreDefaultAccounts(mine, NOW);
    expect(names(restored)).toEqual(["Cash", "HDFC", "UPI", "Debit card", "Credit card", "Net banking", "Wallet"]);
    expect(restored.accounts.find((a) => a.id === "hdfc")!.openingBalanceMinor).toBe(100_000);
    expect(restoreDefaultAccounts(restored, NOW)).toBe(restored); // nothing missing: no change
  });
});
