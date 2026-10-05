"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activityHref, monthFilter } from "@/lib/charts/links";
import { formatBps, formatCompactINR, formatExactINR, formatHeadlineINR } from "@/lib/charts/format";
import {
  addDays,
  formatDayMonth,
  formatDisplayDate,
  formatMonthLong,
  formatMonthShort,
  formatWeekdayShort,
  monthEnd,
  monthStart,
} from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import { periodReport } from "@/lib/finance/state";
import { changeBps } from "@/lib/finance/series";
import { ColumnChart, type Column } from "../charts/column-chart";
import { LineChart, type ChartSeries } from "../charts/line-chart";
import { ChartCard, EmptyChart, Headline, RangeTabs } from "../charts/primitives";
import { TooltipCard, TooltipHint, TooltipRow, TooltipTitle } from "../charts/tooltip";
import { useFinance } from "../finance-provider";
import { GAIN, LOSS } from "./net-worth-section";

type Span = "6M" | "12M";

/** Is more money coming in than going out? */
export function IncomeExpenseSection({ model }: { model: DashboardModel }) {
  const router = useRouter();
  const [span, setSpan] = useState<Span>("6M");
  const months = useMemo(() => model.months.slice(span === "6M" ? -6 : -12), [model.months, span]);
  const xs = useMemo(() => months.map((_, i) => i), [months]);
  const series = useMemo<ChartSeries[]>(
    () => [
      { key: "income", label: "Income", color: GAIN, values: months.map((m) => m.incomeMinor), area: true },
      { key: "expenses", label: "Expenses", color: LOSS, values: months.map((m) => m.expensesMinor) },
    ],
    [months],
  );

  const active = months.filter((m) => m.incomeMinor > 0 || m.expensesMinor > 0);
  const positive = active.filter((m) => m.incomeMinor >= m.expensesMinor).length;
  const current = model.current;
  const saved = current.savingsMinor;

  return (
    <ChartCard
      title="Income vs expenses"
      action={
        <RangeTabs
          label="Income and expenses range"
          value={span}
          options={[{ value: "6M", label: "6M" }, { value: "12M", label: "12M" }]}
          onChange={setSpan}
        />
      }
    >
      <Headline
        value={formatHeadlineINR(saved)}
        delta={saved >= 0 ? "Saved this month" : "Overspent this month"}
        tone={active.length === 0 ? "neutral" : saved >= 0 ? "positive" : "negative"}
        caption={
          active.length === 0
            ? "Record income and spending to see how they compare."
            : `You earned more than you spent in ${positive} of the last ${active.length} ${active.length === 1 ? "month" : "months"}.`
        }
      />
      {active.length === 0 ? (
        <EmptyChart height={200}>Income and expenses will be compared here month by month.</EmptyChart>
      ) : (
        <LineChart
          xs={xs}
          series={series}
          height={220}
          animateKey={`${span}-${active.length}-${current.incomeMinor}-${current.expensesMinor}`}
          ariaLabel="Income and expenses by month"
          formatY={formatCompactINR}
          xLabel={(i) => formatMonthShort(months[i].ym)}
          includeZero
          onSelect={(i) => router.push(activityHref(monthFilter(months[i].ym)))}
          selectLabel="See that month"
          tooltip={(i) => {
            const m = months[i];
            return (
              <TooltipCard>
                <TooltipTitle sub={m.partial ? "Month in progress" : undefined}>{formatMonthLong(m.ym)}</TooltipTitle>
                <TooltipRow label="Income" value={formatExactINR(m.incomeMinor)} color={GAIN} />
                <TooltipRow label="Expenses" value={formatExactINR(m.expensesMinor)} color={LOSS} />
                <div className="my-1.5 border-t border-white/10" />
                <TooltipRow
                  label={m.savingsMinor >= 0 ? "Savings" : "Overspent"}
                  value={formatExactINR(Math.abs(m.savingsMinor))}
                  tone={m.savingsMinor >= 0 ? "positive" : "negative"}
                  strong
                />
                <TooltipHint>Click to see that month</TooltipHint>
              </TooltipCard>
            );
          }}
        />
      )}
      <Legend items={[{ label: "Income", color: GAIN }, { label: "Expenses", color: LOSS }]} />
    </ChartCard>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-3 flex gap-5 text-xs text-slate-500">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

type SpendSpan = "1D" | "1W" | "1M" | "6M" | "1Y";

const SPEND_OPTIONS: { value: SpendSpan; label: string }[] = [
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
];

/** Short windows: bars of `bucketDays` each; the headline covers the last `headlineDays`. */
const DAY_SPANS: Record<"1D" | "1W" | "1M", { bucketDays: number; count: number; headlineDays: number; noun: string }> = {
  "1D": { bucketDays: 1, count: 7, headlineDays: 1, noun: "today" },
  "1W": { bucketDays: 7, count: 4, headlineDays: 7, noun: "in the last 7 days" },
  "1M": { bucketDays: 5, count: 6, headlineDays: 30, noun: "in the last 30 days" },
};

interface SpendBucket {
  key: string;
  label: string;
  title: string;
  sub?: string;
  from: string;
  to: string;
  expensesMinor: number;
  comparableMinor: number | null;
  top?: { categoryId: string; amountMinor: number };
  compareLabel: string;
}

const signed = (bps: number) => `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${formatBps(Math.abs(bps), 1)}`;

/** Am I spending more than before? */
export function SpendingSection({ model }: { model: DashboardModel }) {
  const router = useRouter();
  const { getCategory, book, ledger, today } = useFinance();
  const [span, setSpan] = useState<SpendSpan>("6M");
  const current = model.current;

  const view = useMemo(() => {
    const spent = (from: string, to: string) => periodReport(book, ledger, from, to);

    if (span === "6M" || span === "1Y") {
      const months = model.months.slice(span === "6M" ? -6 : -12);
      const buckets: SpendBucket[] = months.map((m) => ({
        key: m.ym,
        label: formatMonthShort(m.ym),
        title: formatMonthLong(m.ym),
        sub: m.partial ? "Month in progress" : undefined,
        from: monthStart(m.ym),
        to: monthEnd(m.ym),
        expensesMinor: m.expensesMinor,
        comparableMinor: m.comparableExpensesMinor,
        top: m.byCategory[0],
        compareLabel: m.partial ? "vs same point last month" : "Change vs previous month",
      }));
      const bps = model.spendingChangeBps;
      return {
        buckets,
        headline: current.expensesMinor,
        bps,
        caption:
          bps === null
            ? current.expensesMinor > 0
              ? `Spent so far in ${formatMonthLong(current.ym)}.`
              : "Nothing spent yet this month."
            : `Spent so far this month: ${bps > 0 ? "more" : bps < 0 ? "less" : "the same"} than at this point last month.`,
        empty: "Your monthly spending will appear here.",
        aria: `Spending in the last ${months.length} months`,
      };
    }

    const { bucketDays, count, headlineDays, noun } = DAY_SPANS[span];
    const buckets: SpendBucket[] = Array.from({ length: count }, (_, i) => {
      const to = addDays(today, -(count - 1 - i) * bucketDays);
      const from = addDays(to, -(bucketDays - 1));
      const r = spent(from, to);
      const prev = spent(addDays(from, -bucketDays), addDays(from, -1));
      const label =
        bucketDays === 1 ? (to === today ? "Today" : formatWeekdayShort(to)) : formatDayMonth(from);
      return {
        key: from,
        label,
        title: bucketDays === 1 ? formatDisplayDate(to) : `${formatDayMonth(from)} – ${formatDayMonth(to)}`,
        sub: to === today ? (bucketDays === 1 ? "Today" : "Includes today") : undefined,
        from,
        to,
        expensesMinor: r.expensesMinor,
        comparableMinor: prev.expensesMinor,
        top: r.expensesByCategory[0],
        compareLabel: bucketDays === 1 ? "vs previous day" : `vs previous ${bucketDays} days`,
      };
    });
    const start = addDays(today, -(headlineDays - 1));
    const total = spent(start, today).expensesMinor;
    const before = spent(addDays(start, -headlineDays), addDays(start, -1)).expensesMinor;
    const bps = changeBps(total, before);
    const against = headlineDays === 1 ? "yesterday" : `the previous ${headlineDays} days`;
    return {
      buckets,
      headline: total,
      bps,
      caption:
        total === 0
          ? `Nothing spent ${noun}.`
          : bps === null
            ? `Spent ${noun}.`
            : `Spent ${noun}: ${bps > 0 ? "more" : bps < 0 ? "less" : "the same"} than ${against}.`,
      empty: "Your spending will appear here.",
      aria: `Spending ${noun}, by ${bucketDays === 1 ? "day" : `${bucketDays} days`}`,
    };
  }, [span, model, current, book, ledger, today]);

  const { buckets } = view;
  const hasData = buckets.some((b) => b.expensesMinor > 0) || view.headline > 0;

  const columns = useMemo<Column[]>(
    () =>
      buckets.map((b, i) => ({
        key: b.key,
        label: b.label,
        value: b.expensesMinor,
        color: i === buckets.length - 1 ? LOSS : "#fda4af",
        valueLabel: b.expensesMinor > 0 ? formatCompactINR(b.expensesMinor) : "",
      })),
    [buckets],
  );

  return (
    <ChartCard
      title="Spending"
      action={<RangeTabs label="Spending range" value={span} options={SPEND_OPTIONS} onChange={setSpan} />}
    >
      <Headline
        value={formatHeadlineINR(view.headline)}
        delta={view.bps === null ? undefined : signed(view.bps)}
        tone={view.bps === null || view.bps === 0 ? "neutral" : view.bps > 0 ? "negative" : "positive"}
        caption={view.caption}
      />
      {!hasData ? (
        <EmptyChart height={200}>{view.empty}</EmptyChart>
      ) : (
        <ColumnChart
          columns={columns}
          height={230}
          animateKey={`${span}-${buckets.length}-${view.headline}`}
          ariaLabel={view.aria}
          onSelect={(i) => router.push(activityHref({ group: "spending", from: buckets[i].from, to: buckets[i].to }))}
          selectLabel="See transactions"
          tooltip={(i) => {
            const b = buckets[i];
            const change = changeBps(b.expensesMinor, b.comparableMinor);
            return (
              <TooltipCard>
                <TooltipTitle sub={b.sub}>{b.title}</TooltipTitle>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Total spent</p>
                <p className="mb-2 text-xl font-semibold tabular-nums">{formatExactINR(b.expensesMinor)}</p>
                {b.top && <TooltipRow label="Largest category" value={`${getCategory(b.top.categoryId).name} · ${formatExactINR(b.top.amountMinor)}`} />}
                <TooltipRow
                  label={b.compareLabel}
                  value={change === null ? "—" : signed(change)}
                  tone={change === null || change === 0 ? undefined : change > 0 ? "negative" : "positive"}
                  strong
                />
                <TooltipHint>Click to see transactions</TooltipHint>
              </TooltipCard>
            );
          }}
        />
      )}
    </ChartCard>
  );
}
