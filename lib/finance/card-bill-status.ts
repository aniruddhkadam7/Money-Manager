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

type StatementBill = { statementDate?: string; dueDate?: string; totalDueMinor?: number; minimumDueMinor?: number };

/** The bills the statements printed, oldest first; the same statement uploaded twice counts once. */
function printedBills(statements: StatementBill[]): CardStatementInfo[] {
  const byDate = new Map<string, CardStatementInfo>();
  for (const s of statements) {
    if (!s.statementDate || s.totalDueMinor === undefined) continue;
    byDate.set(s.statementDate, { statementDate: s.statementDate, dueDate: s.dueDate, billMinor: s.totalDueMinor, minimumDueMinor: s.minimumDueMinor });
  }
  return [...byDate.values()].sort((a, b) => a.statementDate.localeCompare(b.statementDate));
}

/** A bill's printed due date, and how much of that bill your entries show as paid. */
export interface CardDue extends CardStatementInfo {
  dueDate: string;
  /** Paid towards the card after this statement (and before the next one, for older bills). */
  paidMinor: number;
  remainingMinor: number;
  /** The newest bill: the only one still to pay. An older bill's unpaid part is carried into the next one. */
  latest: boolean;
}

/** Every printed due date for a card, oldest first. Statements that don't print a due date are left out. */
export function cardDueDates(book: Book, cardId: string, statements: StatementBill[]): CardDue[] {
  const bills = printedBills(statements);
  return bills.flatMap((b, i) => {
    if (!b.dueDate) return [];
    const next = bills[i + 1];
    const paidMinor = paidBetween(book, cardId, b.statementDate, next?.statementDate);
    return [{ ...b, dueDate: b.dueDate, paidMinor, remainingMinor: Math.max(0, b.billMinor - paidMinor), latest: !next }];
  });
}

/**
 * Where a card's bill stands, using only what the statements print (total due, due date, statement date)
 * and the bill payments in your entries. Statements whose bill summary couldn't be read are left out:
 * nothing here is estimated. Returns null when no statement printed a bill.
 */
export function cardBillStatus(
  book: Book,
  cardId: string,
  statements: StatementBill[],
): CardBillStatus | null {
  const bills = printedBills(statements);
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
