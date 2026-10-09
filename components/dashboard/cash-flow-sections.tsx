"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activityHref, monthFilter } from "@/lib/charts/links";
import { formatBps, formatCompactINR, formatExactINR, formatHeadlineINR } from "@/lib/charts/format";
import { formatMonthLong, formatMonthShort, monthEnd, monthStart } from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import { changeBps, DEFAULT_PERIOD, MONTHLY_PERIODS, monthlySummaries, monthsInPeriod, type MonthlyPoint, type RangeKey } from "@/lib/finance/series";
import { ColumnChart, type Column } from "../charts/column-chart";
import { LineChart, type ChartSeries } from "../charts/line-chart";
import { ChartCard, EmptyChart, Headline, RangeTabs } from "../charts/primitives";
import { TooltipCard, TooltipHint, TooltipRow, TooltipTitle } from "../charts/tooltip";
import { useFinance } from "../finance-provider";
import { GAIN, LOSS } from "./net-worth-section";

/** The months a month-by-month chart shows for a period; "All" can reach back further than the model's 12. */
function usePeriodMonths(model: DashboardModel, range: RangeKey): MonthlyPoint[] {
  const { book, ledger, today } = useFinance();
  return useMemo(() => {
    const n = monthsInPeriod(range, model.ym, model.firstActivity);
    return n <= model.months.length ? model.months.slice(-n) : monthlySummaries(book, ledger, model.ym, n, today);
  }, [range, model, book, ledger, today]);
}

/** Is more money coming in than going out? */
export function IncomeExpenseSection({ model }: { model: DashboardModel }) {
  const router = useRouter();
  const [span, setSpan] = useState<RangeKey>(DEFAULT_PERIOD);
  const months = usePeriodMonths(model, span);
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
          options={MONTHLY_PERIODS}
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
            ? "No income or spending yet."
            : `Earned more than spent in ${positive} of ${active.length} ${active.length === 1 ? "month" : "months"}`
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

interface SpendBucket {
  key: string;
  label: string;
  title: string;
  sub?: string;
  from: string;
  to: string;
  expensesMinor: number;
  incomeMinor: number;
  comparableMinor: number | null;
  compareLabel: string;
}

const signed = (bps: number) => `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${formatBps(Math.abs(bps), 1)}`;

/** Am I spending more than before? */
export function SpendingSection({ model }: { model: DashboardModel }) {
  const router = useRouter();
  const [span, setSpan] = useState<RangeKey>(DEFAULT_PERIOD);
  const months = usePeriodMonths(model, span);
  const current = model.current;

  const view = useMemo(() => {
    const buckets: SpendBucket[] = months.map((m) => ({
      key: m.ym,
      label: formatMonthShort(m.ym),
      title: formatMonthLong(m.ym),
      sub: m.partial ? "Month in progress" : undefined,
      from: monthStart(m.ym),
      to: monthEnd(m.ym),
      expensesMinor: m.expensesMinor,
      incomeMinor: m.incomeMinor,
      comparableMinor: m.comparableExpensesMinor,
      compareLabel: m.partial ? "Spent vs last month so far" : "Spent vs month before",
    }));
    const bps = model.spendingChangeBps;
    return {
      buckets,
      headline: current.expensesMinor,
      bps,
      caption:
        bps === null
          ? current.expensesMinor > 0
            ? `So far in ${formatMonthLong(current.ym)}`
            : "Nothing spent yet this month."
          : `${bps > 0 ? "More" : bps < 0 ? "Less" : "Same"} than this point last month`,
      empty: "Your monthly spending will appear here.",
      aria: `Spending in the last ${months.length} months`,
    };
  }, [months, model, current]);

  const { buckets } = view;
  const hasData = buckets.some((b) => b.expensesMinor > 0 || b.incomeMinor > 0) || view.headline > 0;

  const columns = useMemo<Column[]>(
    () =>
      buckets.map((b, i) => {
        // This month in full colour, earlier months lighter: what you earned beside what you spent.
        const now = i === buckets.length - 1;
        const spent = { value: b.expensesMinor, color: now ? LOSS : "#fda4af", valueLabel: b.expensesMinor > 0 ? formatCompactINR(b.expensesMinor) : "" };
        const earned = { value: b.incomeMinor, color: now ? GAIN : "#6ee7b7", valueLabel: b.incomeMinor > 0 ? formatCompactINR(b.incomeMinor) : "" };
        return { key: b.key, label: b.label, ...spent, bars: [earned, spent] };
      }),
    [buckets],
  );

  return (
    <ChartCard
      title="Spending"
      action={<RangeTabs label="Spending range" value={span} options={MONTHLY_PERIODS} onChange={setSpan} />}
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
                <TooltipRow label="Earned" value={formatExactINR(b.incomeMinor)} color={GAIN} />
                <TooltipRow label="Spent" value={formatExactINR(b.expensesMinor)} color={LOSS} />
                <div className="my-1.5 border-t border-white/10" />
                <TooltipRow
                  label={b.incomeMinor >= b.expensesMinor ? "Saved" : "Overspent"}
                  value={formatExactINR(Math.abs(b.incomeMinor - b.expensesMinor))}
                  tone={b.incomeMinor >= b.expensesMinor ? "positive" : "negative"}
                  strong
                />
                {change !== null && (
                  <TooltipRow label={b.compareLabel} value={signed(change)} tone={change > 0 ? "negative" : change < 0 ? "positive" : undefined} />
                )}
                <TooltipHint>Click to see transactions</TooltipHint>
              </TooltipCard>
            );
          }}
        />
      )}
      {hasData && <Legend items={[{ label: "Earned", color: GAIN }, { label: "Spent", color: LOSS }]} />}
    </ChartCard>
  );
}
