import { brandFor } from "./brands";
import { isMoneyBack } from "./state";
import type { Book, Ledger } from "./types";

/** Where income comes from, grouped by who paid (or by category when no payer was named). */
export interface IncomeSource {
  key: string;
  name: string;
  categoryId: string;
  amountMinor: number;
  /** How many separate payments. */
  count: number;
  lastDate: string;
}

/**
 * Income received between `from` and `to` (inclusive), largest first. Only real
 * income counts: borrowed money, repayments, investment sales, refunds and reimbursements are not income
 * (as everywhere else in the app). A recognised company is one source under its own name, however the
 * bank wrote it ("ERNST YOUNG LLP HSBC01100" and "EY" are both EY).
 */
export function incomeSources(
  book: Book,
  ledger: Ledger,
  from: string,
  to: string,
  categoryName: (id: string) => string,
): IncomeSource[] {
  const applied = new Set(ledger.entries.map((e) => e.sourceId));
  const groups = new Map<string, IncomeSource>();

  for (const e of book.events) {
    if (e.type !== "income" || isMoneyBack(e) || !applied.has(e.id) || e.date < from || e.date > to) continue;
    const payer = e.description?.trim();
    const brand = payer ? brandFor(payer) : null;
    const name = brand?.name ?? (payer || categoryName(e.categoryId));
    const key = brand ? `brand:${brand.slug}` : name.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.amountMinor += e.amountMinor;
      existing.count += 1;
      if (e.date > existing.lastDate) existing.lastDate = e.date;
    } else {
      groups.set(key, { key, name, categoryId: e.categoryId, amountMinor: e.amountMinor, count: 1, lastDate: e.date });
    }
  }

  return [...groups.values()].sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));
}
