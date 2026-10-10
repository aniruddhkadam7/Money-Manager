import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "@/lib/domain/categories";
import { defaultAccounts } from "@/lib/finance/migrate";
import type { Book } from "@/lib/finance/types";
import { AUTO_ACCOUNT, detectAccount, processStatement } from "@/lib/statements/pipeline";
import { emptyImportStore, StatementError } from "@/lib/statements/types";
import { fixture, nodePdfjs } from "./pdf-helpers";

const book = (extra: Book["accounts"] = []): Book => ({
  accounts: [...defaultAccounts("2026-01-01T00:00:00Z"), ...extra],
  people: [],
  events: [],
  setup: { defaultAccountsAdded: true, defaultsVersion: 2 },
});
const acct = (id: string, name: string, type: "bank" | "credit_card") => ({ id, name, type, openingBalanceMinor: 0, openedOn: "2026-01-01", createdAt: "2026-01-01T00:00:00Z" });
const bankRows = [{ balanceMinor: 100 }, { balanceMinor: 200 }];
const cardRows = [{}, {}];
const noMemory = { accountByMask: {} };

describe("detecting a statement's account", () => {
  it("puts a bank statement in the main bank account and a card statement in the card", () => {
    expect(detectAccount(book(), noMemory, { rows: bankRows }, false)).toBe("account-netbanking");
    expect(detectAccount(book(), noMemory, { rows: cardRows }, true)).toBe("account-credit");
  });

  it("uses the account this bank and number went to last time", () => {
    const b = book([acct("acc-axis", "Salary account", "bank")]);
    const store = { accountByMask: { "Axis Bank:3520": "acc-axis" } };
    expect(detectAccount(b, store, { bankHint: "Axis Bank", accountMask: "3520", rows: bankRows }, false)).toBe("acc-axis");
  });

  it("matches an account named with the statement's last four digits, then one named after the bank", () => {
    const b = book([acct("acc-hdfc", "HDFC Savings", "bank"), acct("acc-2018", "Joint a/c 2018", "bank"), acct("acc-hdfc-card", "HDFC Regalia", "credit_card")]);
    expect(detectAccount(b, noMemory, { bankHint: "HDFC Bank", accountMask: "2018", rows: bankRows }, false)).toBe("acc-2018");
    expect(detectAccount(b, noMemory, { bankHint: "HDFC Bank", accountMask: "9999", rows: bankRows }, false)).toBe("acc-hdfc");
    expect(detectAccount(b, noMemory, { bankHint: "HDFC Bank", rows: cardRows }, true)).toBe("acc-hdfc-card");
  });

  it("never sends a bank statement to a card, even if the card was used for this number before", () => {
    const store = { accountByMask: { ":3520": "account-credit" } };
    expect(detectAccount(book(), store, { accountMask: "3520", rows: bankRows }, false)).toBe("account-netbanking");
  });

  it("says what to do when there's no account of the right kind", () => {
    const b: Book = { ...book(), accounts: book().accounts.filter((a) => a.type !== "credit_card") };
    expect(() => detectAccount(b, noMemory, { rows: cardRows }, true)).toThrow(StatementError);
  });

  it("reads a real statement into the detected account", async () => {
    let n = 0;
    const { record } = await processStatement(
      {
        data: fixture("hdfc_style.pdf"),
        filename: "hdfc_style.pdf",
        accountId: AUTO_ACCOUNT,
        book: book(),
        store: emptyImportStore(),
        categories: { expenseCategories: DEFAULT_CATEGORIES, incomeCategories: DEFAULT_INCOME_CATEGORIES },
      },
      { pdfjs: await nodePdfjs(), now: () => "2026-10-05T10:00:00.000Z", newId: () => `id-${++n}` },
    );
    expect(record.accountId).toBe("account-netbanking");
  });
});

describe("not guessing an account named after another bank", () => {
  const named = book([acct("acc-hdfc", "HDFC Bank", "bank")]).accounts.filter((a) => a.id === "acc-hdfc" || a.type === "credit_card");

  it("never files another bank's statement, or one that names no bank, under an account named after a bank", () => {
    const b: Book = { ...book(), accounts: named };
    expect(() => detectAccount(b, noMemory, { bankHint: "Kotak Mahindra Bank", accountMask: "2018", rows: bankRows }, false)).toThrow(/Kotak Mahindra Bank.*Choose the account/);
    expect(() => detectAccount(b, noMemory, { accountMask: "2018", rows: bankRows }, false)).toThrow(/doesn't say which bank/);
    expect(detectAccount(b, noMemory, { bankHint: "HDFC Bank", rows: bankRows }, false)).toBe("acc-hdfc");
  });

  it("prefers a plain account over one named after a different bank", () => {
    const b = book([acct("acc-hdfc", "HDFC Bank", "bank")]);
    expect(detectAccount(b, noMemory, { bankHint: "Kotak Mahindra Bank", rows: bankRows }, false)).toBe("account-netbanking");
  });
});

describe("an account number seen before", () => {
  it("goes back to the account it went to last time, even if the bank was read differently then", () => {
    // First read as HDFC (wrongly), so "Net banking" was renamed "HDFC Bank"; now the statement reads as Kotak.
    const b: Book = { ...book(), accounts: book().accounts.map((a) => (a.id === "account-netbanking" ? { ...a, name: "HDFC Bank" } : a)) };
    const store = { accountByMask: { "HDFC Bank:2018": "account-netbanking" } };
    expect(detectAccount(b, store, { bankHint: "Kotak Mahindra Bank", accountMask: "2018", rows: bankRows }, false)).toBe("account-netbanking");
  });
});
