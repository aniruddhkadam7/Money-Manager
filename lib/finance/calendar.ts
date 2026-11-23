import { addDays, daysBetween, monthEnd, monthStart, shiftMonth } from "@/lib/domain/dates";
import type { CardDue } from "./card-bill-status";
import { periodReport } from "./state";
import type { Book, FinancialEvent, Ledger } from "./types";

export interface CalendarDay {
  date: string;
  /** False for the greyed days of the months either side that fill out the first and last weeks. */
  inMonth: boolean;
  /** Genuine income, as the dashboard counts it (refunds are not income). */
  incomeMinor: number;
  /** Genuine spending, net of refunds that day; negative when more came back than was spent. */
  expensesMinor: number;
  /** Every entry dated that day, counted or not (transfers, loans, investments...). */
  entryCount: number;
  /**
   * Money that went out on debts, neither spending nor income: paying people back, lending, and EMIs' principal
   * (interest on top is spending, counted above).
   */
  debtOutMinor: number;
  /** Money that came in on debts: borrowing, being paid back, a loan paid out to you. */
  debtInMinor: number;
}

/** What an entry moved on debts: out (paying back, lending, EMI principal) or in (borrowing, repaid, a loan). */
export function debtMoney(e: FinancialEvent): { out: number; in: number } {
  switch (e.type) {
    case "repayment_made":
      return { out: e.amountMinor - (e.interestMinor ?? 0), in: 0 };
    case "lend":
      return { out: e.predatesRecords ? 0 : e.amountMinor, in: 0 };
    case "emi_payment":
      return { out: e.amountMinor - e.interestMinor, in: 0 };
    case "borrow":
      // A service on credit brings no money in; one from before tracking moves none now.
      return { out: 0, in: e.for === "service" || e.predatesRecords ? 0 : e.amountMinor };
    case "repayment_received":
    case "loan_taken":
      return { out: 0, in: e.amountMinor };
    default:
      return { out: 0, in: 0 };
  }
}

/** Weeks start on Sunday, like a wall calendar. */
const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

/**
 * A month as whole weeks (Sunday to Saturday), each day with its income and spending. The numbers come
 * from the same period report as the dashboard, so a month's days always add up to its dashboard totals.
 */
export function calendarMonth(book: Book, ledger: Ledger, ym: string): CalendarDay[][] {
  const first = monthStart(ym);
  const last = monthEnd(ym);
  const start = addDays(first, -weekdayOf(first));
  const end = addDays(last, 6 - weekdayOf(last));

  const counts = new Map<string, number>();
  const debts = new Map<string, { out: number; in: number }>();
  for (const e of book.events) {
    if (e.date < start || e.date > end) continue;
    counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
    const m = debtMoney(e);
    if (m.out || m.in) {
      const d = debts.get(e.date) ?? { out: 0, in: 0 };
      debts.set(e.date, { out: d.out + m.out, in: d.in + m.in });
    }
  }

  const weeks: CalendarDay[][] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (weekdayOf(date) === 0) weeks.push([]);
    const entryCount = counts.get(date) ?? 0;
    const r = entryCount > 0 ? periodReport(book, ledger, date, date) : null;
    weeks[weeks.length - 1].push({
      date,
      inMonth: date >= first && date <= last,
      incomeMinor: r?.incomeMinor ?? 0,
      expensesMinor: r?.expensesMinor ?? 0,
      entryCount,
      debtOutMinor: debts.get(date)?.out ?? 0,
      debtInMinor: debts.get(date)?.in ?? 0,
    });
  }
  return weeks;
}

/** A card bill's due date, with the card's name. */
export interface CalendarCardDue extends CardDue {
  accountId: string;
  cardName: string;
}

/** How a month's spending is going: against the month before, and (while it runs) where it is heading. */
export interface MonthPace {
  /** The month before, as "YYYY-MM". */
  previousMonth: string;
  /** Spent in the month before over the same days (all of it, once this month is over); null when it has no entries. */
  previousMinor: number | null;
  /** Whether the comparison covers the whole of both months, rather than the days so far. */
  wholeMonth: boolean;
  /** This month's spending at its pace so far, carried to the month's last day; null once the month is over. */
  projectedMinor: number | null;
}

export function monthPace(book: Book, ledger: Ledger, ym: string, today: string, spentMinor: number): MonthPace | null {
  const first = monthStart(ym);
  const last = monthEnd(ym);
  if (first > today) return null; // a future month: nothing spent yet

  const previousMonth = shiftMonth(ym, -1);
  const prevFirst = monthStart(previousMonth);
  const prevLast = monthEnd(previousMonth);
  const wholeMonth = today >= last;
  // The same days of the month before, stopping at its end (30 Mar compares with all of February).
  const daysSoFar = daysBetween(first, today) + 1;
  const prevTo = wholeMonth ? prevLast : [addDays(prevFirst, daysSoFar - 1), prevLast].sort()[0];
  const hasPrevious = book.events.some((e) => e.date >= prevFirst && e.date <= prevLast);

  return {
    previousMonth,
    previousMinor: hasPrevious ? periodReport(book, ledger, prevFirst, prevTo).expensesMinor : null,
    wholeMonth,
    projectedMinor: wholeMonth ? null : Math.round((spentMinor / daysSoFar) * (daysBetween(first, last) + 1)),
  };
}

/** How strongly a day is shaded for what went out: 0 for nothing, up to 4 for the month's heaviest days. */
export type SpendLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Each of the month's days with spending, graded against the month itself. The top of the scale is the
 * 90th-percentile day rather than the biggest, so one rent payment doesn't leave every other day pale.
 */
export function spendLevels(days: CalendarDay[]): Map<string, SpendLevel> {
  const spending = days.filter((d) => d.inMonth && d.expensesMinor > 0);
  const sorted = spending.map((d) => d.expensesMinor).sort((a, b) => a - b);
  const top = sorted[Math.ceil(sorted.length * 0.9) - 1] ?? 0;
  return new Map(spending.map((d) => [d.date, Math.max(1, Math.ceil(Math.min(1, d.expensesMinor / top) * 4)) as SpendLevel]));
}
