import { activityHref, monthFilter } from "@/lib/charts/links";
import { daysBetween } from "@/lib/domain/dates";
import { formatBps, formatExactINR } from "@/lib/charts/format";
import type { HealthMetrics, MonthlyPoint } from "./series";
import type { RecurringCharge } from "./recurring";
import type { PersonSummary } from "./state";

/**
 * Plain-language observations written from the numbers by fixed templates.
 * Every figure in a sentence is a computed value; nothing is generated.
 */

export interface Insight {
  id: string;
  tone: "positive" | "negative" | "neutral";
  text: string;
  href?: string;
}

export interface InsightInput {
  /** Oldest first; the last item is the month in progress. */
  months: MonthlyPoint[];
  categoryName: (id: string) => string;
  /** Net worth now minus net worth at the end of last month. */
  netWorthChangeMinor: number | null;
  people: PersonSummary[];
  upcoming: RecurringCharge[];
  health: HealthMetrics;
  today: string;
}

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function buildInsights(input: InsightInput): Insight[] {
  const { months, categoryName, people, upcoming, health, today } = input;
  const current = months[months.length - 1];
  const out: Insight[] = [];
  if (!current) return out;

  // 1. Am I spending more or less than I usually do at this point?
  const prev = current.comparableExpensesMinor;
  if (prev !== null && prev > 0 && current.expensesMinor > 0) {
    const diff = current.expensesMinor - prev;
    if (Math.abs(diff) >= prev * 0.02) {
      const before = new Map(current.comparableByCategory.map((c) => [c.categoryId, c.amountMinor]));
      const drivers = current.byCategory
        .map((c) => ({ id: c.categoryId, delta: c.amountMinor - (before.get(c.categoryId) ?? 0) }))
        .filter((c) => (diff > 0 ? c.delta > 0 : c.delta < 0))
        .sort((a, b) => (diff > 0 ? b.delta - a.delta : a.delta - b.delta))
        .slice(0, 2)
        .map((c) => categoryName(c.id));
      const more = diff > 0;
      out.push({
        id: "spend-change",
        tone: more ? "negative" : "positive",
        text: `You've spent ${formatExactINR(Math.abs(diff))} ${more ? "more" : "less"} than at this point last month${
          drivers.length ? `, mainly on ${list(drivers)}` : ""
        }.`,
        href: activityHref({ group: "spending", ...monthFilter(current.ym) }),
      });
    }
  }

  // 2. Is my wealth growing?
  if (input.netWorthChangeMinor !== null && input.netWorthChangeMinor !== 0) {
    const up = input.netWorthChangeMinor > 0;
    out.push({
      id: "net-worth",
      tone: up ? "positive" : "negative",
      text: `Your net worth is ${up ? "up" : "down"} ${formatExactINR(Math.abs(input.netWorthChangeMinor))} this month.`,
    });
  }

  // 3. Where is the money going?
  const top = current.byCategory[0];
  if (top && current.expensesMinor > 0) {
    const share = Math.round((top.amountMinor / current.expensesMinor) * 100);
    out.push({
      id: "top-category",
      tone: "neutral",
      text: `${categoryName(top.categoryId)} is your biggest expense this month: ${formatExactINR(top.amountMinor)} (${share}% of spending).`,
      href: activityHref({ category: top.categoryId, ...monthFilter(current.ym) }),
    });
  }

  // 4. Am I keeping what I earn?
  if (health.savingsRateBps !== null) {
    const rate = health.savingsRateBps;
    out.push({
      id: "savings-rate",
      tone: rate >= 0 ? "positive" : "negative",
      text:
        rate >= 0
          ? `You're keeping ${formatBps(rate)} of what you earned this month.`
          : `You've spent ${formatBps(Math.abs(rate))} more than you earned this month.`,
    });
  }

  // 5. Is money coming back?
  const owed = people
    .filter((p) => p.owedToMe.outstandingMinor > 0)
    .sort((a, b) => b.owedToMe.outstandingMinor - a.owedToMe.outstandingMinor);
  if (owed.length > 0) {
    const [first] = owed;
    out.push({
      id: "owed",
      tone: "neutral",
      text:
        owed.length === 1
          ? `${first.person.name} owes you ${formatExactINR(first.owedToMe.outstandingMinor)}.`
          : `${owed.length} people owe you ${formatExactINR(owed.reduce((t, p) => t + p.owedToMe.outstandingMinor, 0))} in total, most of it ${first.person.name}.`,
      href: owed.length === 1 ? activityHref({ person: first.person.id }) : activityHref({ group: "people" }),
    });
  }

  // 6. What's coming up?
  const next = upcoming[0];
  if (next) {
    const days = daysBetween(today, next.nextDate);
    const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    out.push({
      id: "upcoming",
      tone: "neutral",
      text: `${next.name} (${formatExactINR(next.amountMinor)}) is expected ${when}.`,
      href: activityHref({ q: next.name, category: next.categoryId }),
    });
  }

  return out.slice(0, 5);
}
