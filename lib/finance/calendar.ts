import { addDays, monthEnd, monthStart } from "@/lib/domain/dates";
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
