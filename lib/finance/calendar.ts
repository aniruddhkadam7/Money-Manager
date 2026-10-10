import { addDays, monthEnd, monthStart } from "@/lib/domain/dates";
import type { CardDue } from "./card-bill-status";
import { nthAfter, type RecurringCharge } from "./recurring";
import { periodReport } from "./state";
import type { Book, Ledger } from "./types";

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
  for (const e of book.events) if (e.date >= start && e.date <= end) counts.set(e.date, (counts.get(e.date) ?? 0) + 1);

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
    });
  }
  return weeks;
}

/** A repeating payment's next turn, placed on the day it should come. */
export interface ExpectedPayment {
  date: string;
  charge: RecurringCharge;
  /** Its day has passed (by a few days at most) and the payment isn't recorded yet. */
  overdue: boolean;
}

/** How late a payment can be and still be expected; the dashboard's "Coming up" uses the same allowance. */
const GRACE_DAYS = 3;

/**
 * Every turn of the repeating payments that falls between `from` and `to`, from the next one on. Each
 * turn is counted from the last real payment, so once that payment is recorded the expected one is
 * gone and the rhythm moves on. A turn missed by more than a few days is dropped (the payment moved or
 * stopped), but the ones after it are still expected. Only rhythms seen in your history are used.
 */
export function expectedPayments(charges: RecurringCharge[], today: string, from: string, to: string): ExpectedPayment[] {
  const out: ExpectedPayment[] = [];
  const earliest = addDays(today, -GRACE_DAYS);
  for (const charge of charges) {
    // A rhythm guessed from one payment (a known service, or filed under Subscriptions) is no date to put on a calendar.
    if (charge.assumed) continue;
    for (let n = 1; ; n++) {
      const date = nthAfter(charge.lastDate, charge.frequency, n);
      if (date > to) break;
      if (date < earliest || date < from) continue;
      out.push({ date, charge, overdue: date < today });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.charge.amountMinor - a.charge.amountMinor);
}

/** A card bill's due date, with the card's name. */
export interface CalendarCardDue extends CardDue {
  accountId: string;
  cardName: string;
}

/** What is still to come in a month: the repeating payments due from today on, and card bills not yet paid. */
export interface MonthOutlook {
  /** Repeating payments still expected this month (overdue ones not recorded yet included). */
  expectedMinor: number;
  expectedCount: number;
  /** What's left to pay on the latest card bills due this month. */
  cardBillsMinor: number;
  cardBillCount: number;
}

export function monthOutlook(ym: string, today: string, expected: ExpectedPayment[], dues: CalendarCardDue[]): MonthOutlook | null {
  const first = monthStart(ym);
  const last = monthEnd(ym);
  if (last < addDays(today, -GRACE_DAYS)) return null; // a past month: nothing is still to come
  const inMonth = expected.filter((p) => p.date >= first && p.date <= last);
  const unpaid = dues.filter((d) => d.latest && d.remainingMinor > 0 && d.dueDate >= first && d.dueDate <= last);
  return {
    expectedMinor: inMonth.reduce((t, p) => t + p.charge.amountMinor, 0),
    expectedCount: inMonth.length,
    cardBillsMinor: unpaid.reduce((t, d) => t + d.remainingMinor, 0),
    cardBillCount: unpaid.length,
  };
}
