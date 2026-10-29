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

/** An uploaded card statement: the period it covers and the bill read from it. */
export interface CardStatementSource {
  accountId?: string;
  status?: string;
  periodStart?: string;
  periodEnd?: string;
  cardBill?: StatementBill;
}

/** A statement is dated on its last day or a day or two after; a printed date further off was misread. */
const STATEMENT_DATE_GRACE_DAYS = 3;

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * A card's bills from its uploaded statements. The printed statement date is checked against the period the
 * statement covers: when it's missing, outside that period, or the same as on a statement for another period
 * (another date on the page was read), the period's last day is used, so each statement keeps its own place.
 */
export function cardStatementBills(imports: CardStatementSource[], cardId: string): StatementBill[] {
  const statements = imports.filter((i) => i.accountId === cardId && i.status !== "FAILED");
  const periodsOn = new Map<string, Set<string>>();
  for (const i of statements) {
    const d = i.cardBill?.statementDate;
    if (d && i.periodEnd) periodsOn.set(d, (periodsOn.get(d) ?? new Set()).add(i.periodEnd));
  }
  return statements.map((i) => {
    const bill = i.cardBill ?? {};
    if (!i.periodEnd) return bill;
    const d = bill.statementDate;
    const fits =
      !!d && d >= (i.periodStart ?? i.periodEnd) && d <= addDays(i.periodEnd, STATEMENT_DATE_GRACE_DAYS) && periodsOn.get(d)!.size === 1;
    return fits ? bill : { ...bill, statementDate: i.periodEnd };
  });
}

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

/** The limit a card is taken to have when none is set on it. */
export const DEFAULT_CARD_LIMIT_MINOR = 6_000_000;

export interface CardUsage {
  /** Taken from the card's limit right now: the latest bill's unpaid part plus what's been spent since it. */
  usedMinor: number;
  /** Still to pay on the latest bill, and by when (when its statement printed a due date). */
  dueMinor: number;
  dueDate?: string;
  /** Spent on the card after the latest statement: on the next bill. */
  unbilledMinor: number;
}

/**
 * How much of a card's limit is in use, going by its statements: the latest bill less the payments made after
 * its statement date, plus purchases (less refunds) charged after that date. A payment beyond the bill counts
 * against the new spending. With no printed bill, it's what your entries say is owed (`balanceMinor`).
 */
export function cardUsage(book: Book, cardId: string, statements: StatementBill[], balanceMinor: number): CardUsage {
  const status = cardBillStatus(book, cardId, statements);
  if (!status) return { usedMinor: Math.max(0, balanceMinor), dueMinor: 0, unbilledMinor: Math.max(0, balanceMinor) };
  const after = status.latest.statementDate;
  let unbilledMinor = 0;
  for (const e of book.events) {
    if (e.date <= after || !("accountId" in e) || e.accountId !== cardId) continue;
    if (e.type === "expense" || e.type === "reimbursable_expense") unbilledMinor += e.amountMinor;
    else if (e.type === "split_expense") unbilledMinor += e.totalMinor;
    else if (e.type === "income") unbilledMinor -= e.amountMinor;
  }
  return {
    usedMinor: Math.max(0, status.latest.billMinor + unbilledMinor - status.paidSinceMinor),
    dueMinor: status.remainingMinor,
    dueDate: status.latest.dueDate,
    unbilledMinor,
  };
}
