import { monthEnd, shiftMonth } from "@/lib/domain/dates";
import { buildInsights, type Insight } from "./insights";
import { detectRecurring, fixedCommitmentsMinor, subscriptionsOf, upcomingCharges, type RecurringCharge } from "./recurring";
import {
  balanceSeries,
  changeBps,
  firstActivityDate,
  healthMetrics,
  monthlySummaries,
  type HealthMetrics,
  type MonthlyPoint,
} from "./series";
import type { FinancialState } from "./state";
import type { Book, Ledger } from "./types";

/**
 * Everything the dashboard shows, as plain structured data computed from the
 * ledger. Charts only draw this; they never compute or invent numbers.
 */
export interface DashboardModel {
  today: string;
  ym: string;
  /** Last 12 months, oldest first; the last is the month in progress. */
  months: MonthlyPoint[];
  current: MonthlyPoint;
  previous: MonthlyPoint | null;
  /** Net worth now minus net worth at the end of last month; null before there is any history. */
  netWorthChangeMinor: number | null;
  /** This month's spending vs the same point last month. */
  spendingChangeBps: number | null;
  firstActivity: string | null;
  recurring: RecurringCharge[];
  upcoming: RecurringCharge[];
  subscriptions: RecurringCharge[];
  fixedCommitmentsMinor: number;
  health: HealthMetrics;
  insights: Insight[];
}

export function buildDashboardModel(
  book: Book,
  ledger: Ledger,
  state: FinancialState,
  today: string,
  categoryName: (id: string) => string,
): DashboardModel {
  const ym = today.slice(0, 7);
  const months = monthlySummaries(book, ledger, ym, 12, today);
  const current = months[months.length - 1];
  const previous = months.length > 1 ? months[months.length - 2] : null;

  const firstActivity = firstActivityDate(ledger);
  const lastMonthEnd = monthEnd(shiftMonth(ym, -1));
  let netWorthChangeMinor: number | null = null;
  if (firstActivity !== null) {
    const [before, now] = balanceSeries(book, ledger, [lastMonthEnd, today]);
    netWorthChangeMinor = now.netWorthMinor - before.netWorthMinor;
  }

  const recurring = detectRecurring(book, ledger, today);
  const upcoming = upcomingCharges(recurring, today, 30);
  const fixed = fixedCommitmentsMinor(recurring);
  const health = healthMetrics(current, state, fixed);

  return {
    today,
    ym,
    months,
    current,
    previous,
    netWorthChangeMinor,
    spendingChangeBps: changeBps(current.expensesMinor, current.comparableExpensesMinor),
    firstActivity,
    recurring,
    upcoming,
    subscriptions: subscriptionsOf(recurring),
    fixedCommitmentsMinor: fixed,
    health,
    insights: buildInsights({
      months,
      categoryName,
      netWorthChangeMinor,
      people: state.people,
      upcoming,
      health,
      today,
    }),
  };
}
