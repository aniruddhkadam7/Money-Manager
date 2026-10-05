import type { Expense } from "@/lib/domain/types";
import { moneyBackCategoryOf } from "./state";
import type { Account, Book, ExpenseEvent } from "./types";

export const DEFAULT_ACCOUNT_ID = "account-cash";

/** Bumped when the standard set gains accounts, so existing people get just the new ones, once. */
export const DEFAULTS_VERSION = 2;

/** Standard accounts added in version 2 (people on version 1 already have the rest). */
const ADDED_IN_V2 = new Set(["account-netbanking", "account-wallet"]);

/**
 * The fixed set of ways people actually pay. There is no "add a bank account":
 * you pick one of these and set its starting balance. Each starts empty.
 */
export function defaultAccounts(now: string): Account[] {
  const base = { openingBalanceMinor: 0, openedOn: "2000-01-01", createdAt: now };
  return [
    { id: DEFAULT_ACCOUNT_ID, name: "Cash", type: "cash", ...base },
    { id: "account-upi", name: "UPI", type: "bank", ...base },
    { id: "account-debit", name: "Debit card", type: "bank", ...base },
    { id: "account-credit", name: "Credit card", type: "credit_card", ...base },
    { id: "account-netbanking", name: "Net banking", type: "bank", ...base },
    { id: "account-wallet", name: "Wallet", type: "cash", ...base },
  ];
}

const stamp = (defaultsVersion: number) => ({ defaultAccountsAdded: true, defaultsVersion });

/**
 * One-time updates to the standard accounts:
 *  - only the starter Cash account (or none): add the whole set;
 *  - already given the first four: add just the ones introduced since;
 *  - set up their own accounts before: leave them alone (they can restore the set from the Money page).
 * Nothing is ever re-added after it has run, even if the person deleted some.
 */
export function withDefaultAccounts(book: Book, now: string): Book {
  const version = book.setup?.defaultsVersion ?? (book.setup?.defaultAccountsAdded ? 1 : 0);
  if (version >= DEFAULTS_VERSION) return book;

  const have = new Set(book.accounts.map((a) => a.id));
  const wanted = defaultAccounts(now);

  if (version === 0) {
    const onlyStarter = book.accounts.every((a) => a.id === DEFAULT_ACCOUNT_ID);
    if (!onlyStarter) return { ...book, setup: stamp(DEFAULTS_VERSION) };
    return { ...book, accounts: [...book.accounts, ...wanted.filter((a) => !have.has(a.id))], setup: stamp(DEFAULTS_VERSION) };
  }

  const added = wanted.filter((a) => ADDED_IN_V2.has(a.id) && !have.has(a.id));
  return { ...book, accounts: [...book.accounts, ...added], setup: stamp(DEFAULTS_VERSION) };
}

/** Which standard accounts are missing (deleted, or never offered). */
export function missingDefaultAccounts(book: Book, now: string): Account[] {
  const have = new Set(book.accounts.map((a) => a.id));
  return defaultAccounts(now).filter((a) => !have.has(a.id));
}

/** Puts back any standard accounts that are missing. Existing accounts are untouched. */
export function restoreDefaultAccounts(book: Book, now: string): Book {
  const missing = missingDefaultAccounts(book, now);
  return missing.length === 0 ? book : { ...book, accounts: [...book.accounts, ...missing], setup: stamp(DEFAULTS_VERSION) };
}

/**
 * Turns the old expense-only data into the event model. Each old expense becomes
 * an expense event paid from the default "Cash" account, so nothing the user
 * already recorded is lost and every number keeps its meaning.
 */
export function bookFromLegacyExpenses(expenses: Expense[], now: string): Book {
  const events: ExpenseEvent[] = expenses.map((e) => ({
    type: "expense" as const,
    id: e.id,
    date: e.date,
    description: e.description,
    accountId: DEFAULT_ACCOUNT_ID,
    amountMinor: e.amountMinor,
    categoryId: e.categoryId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));

  return { accounts: defaultAccounts(now), people: [], events, setup: stamp(DEFAULTS_VERSION) };
}

/** Income categories that just mean "not sorted": safe to correct when the wording says it was money back. */
const GENERIC_INCOME = new Set(["other-income", "other", "gift", "business"]);

/**
 * Refunds and reimbursements recorded as plain income (before the importer knew better) are moved to the
 * Refund / Reimbursement categories, so they stop counting as earnings. Anything deliberately filed
 * elsewhere (salary, interest, your own categories) is left alone.
 */
export function withMoneyBackCategories(book: Book): Book {
  let changed = false;
  const events = book.events.map((e) => {
    if (e.type !== "income" || !GENERIC_INCOME.has(e.categoryId)) return e;
    const text = [e.description, e.note, ...(e.sources ?? []).map((s) => s.narration)].filter(Boolean).join(" ");
    const target = moneyBackCategoryOf(text);
    if (!target) return e;
    changed = true;
    return { ...e, categoryId: target };
  });
  return changed ? { ...book, events } : book;
}
