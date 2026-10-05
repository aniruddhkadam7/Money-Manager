import type { Book } from "./types";

/** One card statement's bill, exactly as printed on it. */
export interface CardStatementInfo {
  statementDate: string;
  /** Printed "Payment due date", when the statement shows one. */
  dueDate?: string;
  /** Printed "Total amount due". */
  billMinor: number;
  minimumDueMinor?: number;
}

export interface CardBillStatus {
  latest: CardStatementInfo;
  /** Paid towards the card since the latest statement (bill payments recorded in your entries). */
  paidSinceMinor: number;
  /** Still to pay on the latest bill (never below zero). */
  remainingMinor: number;
  /** The bill before it, and how much was paid towards it before the next statement. */
  previous?: { info: CardStatementInfo; paidMinor: number; paidInFull: boolean };
}

const paidBetween = (book: Book, cardId: string, after: string, until?: string) =>
  book.events.reduce((t, e) => (e.type === "transfer" && e.toAccountId === cardId && e.date > after && (!until || e.date <= until) ? t + e.amountMinor : t), 0);

/**
 * Where a card's bill stands, using only what the statements print (total due, due date, statement date)
 * and the bill payments in your entries. Statements whose bill summary couldn't be read are left out:
 * nothing here is estimated. Returns null when no statement printed a bill.
 */
export function cardBillStatus(
  book: Book,
  cardId: string,
  statements: { statementDate?: string; dueDate?: string; totalDueMinor?: number; minimumDueMinor?: number }[],
): CardBillStatus | null {
  const bills: CardStatementInfo[] = statements
    .filter((s): s is typeof s & { statementDate: string; totalDueMinor: number } => !!s.statementDate && s.totalDueMinor !== undefined)
    .map((s) => ({ statementDate: s.statementDate, dueDate: s.dueDate, billMinor: s.totalDueMinor, minimumDueMinor: s.minimumDueMinor }))
    .sort((a, b) => a.statementDate.localeCompare(b.statementDate));
  if (bills.length === 0) return null;

  const latest = bills[bills.length - 1];
  const paidSinceMinor = paidBetween(book, cardId, latest.statementDate);
  const prior = bills.length > 1 ? bills[bills.length - 2] : undefined;
  const previous = prior
    ? (() => {
        const paidMinor = paidBetween(book, cardId, prior.statementDate, latest.statementDate);
        return { info: prior, paidMinor, paidInFull: paidMinor >= prior.billMinor };
      })()
    : undefined;

  return { latest, paidSinceMinor, remainingMinor: Math.max(0, latest.billMinor - paidSinceMinor), previous };
}
