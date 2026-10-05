import { isMoneyBack } from "./state";
import type { AccountType, Book } from "./types";

/**
 * Where spending was paid from: your bank account (UPI, debit card, net banking all take money from it),
 * a credit card, or cash. Decided only by the account the purchase is recorded in, never guessed from
 * the bank's wording.
 */
export type PaidFrom = "bank" | "credit_card" | "cash";

export const PAID_FROM_LABEL: Record<PaidFrom, string> = {
  bank: "Bank account",
  credit_card: "Credit card",
  cash: "Cash",
};

export interface SpendByAccount {
  /** Spending before refunds, by where it was paid from (your own share of split bills). */
  parts: { from: PaidFrom; amountMinor: number }[];
  /** Refunds, cashback and reimbursements: they lower the total, exactly as in "Spent". */
  refundsMinor: number;
  /** Equals the period's "Spent". */
  totalMinor: number;
}

const kind = (type: AccountType | undefined): PaidFrom | null =>
  type === "credit_card" ? "credit_card" : type === "cash" ? "cash" : type === "bank" ? "bank" : null;

/** Spending between two dates by where it was paid from; the parts less refunds equal "Spent". */
export function spendByAccount(book: Book, from: string, to: string): SpendByAccount {
  const types = new Map(book.accounts.map((a) => [a.id, a.type]));
  const totals = new Map<PaidFrom, number>();
  const add = (accountId: string, amount: number) => {
    const k = kind(types.get(accountId)) ?? "bank";
    totals.set(k, (totals.get(k) ?? 0) + amount);
  };
  let refunds = 0;
  for (const e of book.events) {
    if (e.date < from || e.date > to) continue;
    if (e.type === "expense") add(e.accountId, e.amountMinor);
    else if (e.type === "split_expense") add(e.accountId, e.totalMinor - e.shares.reduce((t, s) => t + s.amountMinor, 0));
    else if (e.type === "income" && isMoneyBack(e)) refunds += e.amountMinor;
  }
  const parts = (["bank", "credit_card", "cash"] as PaidFrom[]).map((f) => ({ from: f, amountMinor: totals.get(f) ?? 0 })).filter((p) => p.amountMinor !== 0);
  const gross = parts.reduce((t, p) => t + p.amountMinor, 0);
  return { parts, refundsMinor: refunds, totalMinor: gross - refunds };
}
