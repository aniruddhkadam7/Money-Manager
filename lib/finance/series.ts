import { addDays, daysBetween, monthEnd, monthStart, shiftMonth } from "@/lib/domain/dates";
import { periodReport, type FinancialState } from "./state";
import { isAssetAccount, type Book, type Ledger } from "./types";

/**
 * Structured, deterministic time series for charts. Every value comes from the
 * ledger; nothing here is estimated, smoothed or generated.
 */

/** "MTD" is the calendar month so far: from the 1st to today. */
export type RangeKey = "MTD" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "ALL";

const RANGE_DAYS: Record<Exclude<RangeKey, "MTD" | "ALL">, number> = {
  "1M": 30,
  "3M": 91,
  "6M": 182,
  "1Y": 365,
  "3Y": 1095,
};

/**
 * The one set of periods every dashboard card offers, so "6M" means the same thing everywhere.
 * Month-by-month charts leave out 1M (it would be a single bar).
 */
export const PERIODS: { value: RangeKey; label: string; words: string }[] = [
  { value: "1M", label: "1M", words: "in the last 30 days" },
  { value: "3M", label: "3M", words: "in the last 3 months" },
  { value: "6M", label: "6M", words: "in the last 6 months" },
  { value: "1Y", label: "1Y", words: "in the last 12 months" },
  { value: "ALL", label: "All", words: "since you started" },
];
/** The current month from the 1st, offered where a period's totals are shown (not on trend charts). */
export const THIS_MONTH = { value: "MTD", label: "This month", words: "this month" } as const satisfies (typeof PERIODS)[number];
export const MONTHLY_PERIODS = PERIODS.filter((p) => p.value !== "1M");
export const DEFAULT_PERIOD: RangeKey = "6M";
export const periodWords = (range: RangeKey) => [THIS_MONTH, ...PERIODS].find((p) => p.value === range)?.words ?? "";

/** How many calendar months (ending with `endYm`) a period covers on a month-by-month chart. */
export function monthsInPeriod(range: RangeKey, endYm: string, firstActivity: string | null): number {
  if (range === "3M") return 3;
  if (range === "6M") return 6;
  if (range === "1Y") return 12;
  if (range === "3Y") return 36;
  if (range === "1M" || range === "MTD") return 1;
  if (!firstActivity) return 1;
  const [y0, m0] = firstActivity.slice(0, 7).split("-").map(Number);
  const [y1, m1] = endYm.split("-").map(Number);
  return Math.max(1, (y1 - y0) * 12 + (m1 - m0) + 1);
}

/** The earliest day anything actually happened (ignoring pre-set opening dates). Null if nothing yet. */
export function firstActivityDate(ledger: Ledger): string | null {
  let first: string | null = null;
  for (const e of ledger.entries) {
    if (e.kind === "opening") continue;
    if (first === null || e.date < first) first = e.date;
  }
  return first;
}

/** Start date for a chart range. "All" starts at the first real activity, never less than a week back. */
export function rangeStart(range: RangeKey, today: string, firstActivity: string | null): string {
  if (range === "MTD") return monthStart(today.slice(0, 7));
  if (range !== "ALL") return addDays(today, -RANGE_DAYS[range]);
  const week = addDays(today, -7);
  return firstActivity && firstActivity < week ? firstActivity : week;
}

/** Evenly spaced dates from start to end (inclusive), at most `maxPoints`. Always ends exactly on `end`. */
export function sampleDates(start: string, end: string, maxPoints = 90): string[] {
  const span = daysBetween(start, end);
  if (span <= 0) return [end];
  const step = Math.max(1, Math.ceil(span / (maxPoints - 1)));
  const dates: string[] = [];
  for (let offset = 0; offset < span; offset += step) dates.push(addDays(start, offset));
  dates.push(end);
  return dates;
}

/* ---------------- Balance sheet over time ---------------- */

export interface BalancePoint {
  date: string;
  netWorthMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  /** Current value of investments. */
  investmentsMinor: number;
  /** What was put into investments (cost basis). */
  investedMinor: number;
}

/**
 * The balance sheet at the end of each date. `dates` must be ascending. One pass
 * over the ledger, so it stays fast with thousands of entries.
 */
export function balanceSeries(book: Book, ledger: Ledger, dates: string[]): BalancePoint[] {
  const typeOf = new Map(book.accounts.map((a) => [a.id, a.type]));
  const entries = [...ledger.entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let assets = 0;
  let liabilities = 0;
  let investments = 0;
  let invested = 0;
  let i = 0;
  // Each card's running balance: one paid beyond its recorded purchases counts as nothing owed, not as money you have.
  const cards = new Map<string, number>();
  const cardDebt = () => [...cards.values()].reduce((t, owed) => t + Math.max(0, owed), 0);

  return dates.map((date) => {
    for (; i < entries.length && entries[i].date <= date; i++) {
      for (const p of entries[i].postings) {
        if (p.ledger.startsWith("acct:")) {
          const type = typeOf.get(p.ledger.slice(5));
          if (!type) continue;
          if (type === "credit_card") {
            const id = p.ledger.slice(5);
            cards.set(id, (cards.get(id) ?? 0) - p.amountMinor);
          } else if (isAssetAccount(type)) {
            assets += p.amountMinor;
            if (type === "investment") investments += p.amountMinor;
          } else {
            liabilities -= p.amountMinor;
          }
        } else if (p.ledger.startsWith("recv:")) {
          assets += p.amountMinor;
        } else if (p.ledger.startsWith("pay:")) {
          liabilities -= p.amountMinor;
        }
      }
      invested += entries[i].costDelta?.deltaMinor ?? 0;
    }
    const owed = liabilities + cardDebt();
    return {
      date,
      netWorthMinor: assets - owed,
      assetsMinor: assets,
      liabilitiesMinor: owed,
      investmentsMinor: investments,
      investedMinor: invested,
    };
  });
}

/* ---------------- Months ---------------- */

export interface MonthlyPoint {
  ym: string;
  incomeMinor: number;
  expensesMinor: number;
  savingsMinor: number;
  /** Money put into investments that month (gross contributions). */
  investedMinor: number;
  byCategory: { categoryId: string; amountMinor: number }[];
  incomeByCategory: { categoryId: string; amountMinor: number }[];
  /** True for the month in progress. */
  partial: boolean;
  /**
   * Spending to compare this month against: last month's full total, or, for the
   * month in progress, last month up to the same day, so early in a month it
   * isn't unfairly compared with a whole month.
   */
  comparableExpensesMinor: number | null;
  comparableByCategory: { categoryId: string; amountMinor: number }[];
}

/** One point per month, oldest first, ending at `endYm`. */
export function monthlySummaries(book: Book, ledger: Ledger, endYm: string, count: number, today: string): MonthlyPoint[] {
  const currentYm = today.slice(0, 7);
  const yms = Array.from({ length: count + 1 }, (_, i) => shiftMonth(endYm, i - count)); // one extra: the month before the first
  const contributions = new Map<string, number>();
  for (const e of ledger.entries) {
    if (e.kind === "invest" && e.costDelta) {
      const ym = e.date.slice(0, 7);
      contributions.set(ym, (contributions.get(ym) ?? 0) + e.costDelta.deltaMinor);
    }
  }

  return yms.slice(1).map((ym, index) => {
    const prevYm = yms[index];
    const partial = ym === currentYm;
    const report = periodReport(book, ledger, monthStart(ym), monthEnd(ym));

    let comparable;
    if (partial) {
      const day = Number(today.slice(8, 10));
      const prevEnd = `${prevYm}-${String(Math.min(day, Number(monthEnd(prevYm).slice(8, 10)))).padStart(2, "0")}`;
      comparable = periodReport(book, ledger, monthStart(prevYm), prevEnd);
    } else {
      comparable = periodReport(book, ledger, monthStart(prevYm), monthEnd(prevYm));
    }

    return {
      ym,
      incomeMinor: report.incomeMinor,
      expensesMinor: report.expensesMinor,
      savingsMinor: report.savingsMinor,
      investedMinor: contributions.get(ym) ?? 0,
      byCategory: report.expensesByCategory,
      incomeByCategory: report.incomeByCategory,
      partial,
      comparableExpensesMinor: comparable.expensesMinor,
      comparableByCategory: comparable.expensesByCategory,
    };
  });
}

/** Percentage change in basis points, or null when there is nothing to compare with. */
export function changeBps(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 10_000);
}
