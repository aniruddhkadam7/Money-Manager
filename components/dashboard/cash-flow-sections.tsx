"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activityHref } from "@/lib/charts/links";
import { formatBps, formatCompactINR, formatExactINR } from "@/lib/charts/format";
import { formatMonthLong, formatMonthShort, monthEnd, monthStart } from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import { changeBps, MONTHLY_DEFAULT_PERIOD, MONTHLY_PERIODS, monthlySummaries, monthsInPeriod, type MonthlyPoint, type RangeKey } from "@/lib/finance/series";
import { ColumnChart, type Column } from "../charts/column-chart";
import { ChartCard, EmptyChart, RangeTabs } from "../charts/primitives";
import { TooltipCard, TooltipHint, TooltipRow, TooltipTitle } from "../charts/tooltip";
import { useFinance } from "../finance-provider";
import { usePhone } from "../use-phone";
import { GAIN, LOSS } from "./chart-helpers";

/** The months a month-by-month chart shows for a period; "All" can reach back further than the model's 12. */
function usePeriodMonths(model: DashboardModel, range: RangeKey): MonthlyPoint[] {
  const { book, ledger, today } = useFinance();
  return useMemo(() => {
    const n = monthsInPeriod(range, model.ym, model.firstActivity);
    return n <= model.months.length ? model.months.slice(-n) : monthlySummaries(book, ledger, model.ym, n, today);
  }, [range, model, book, ledger, today]);
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

/** Am I spending more than before? Month by month; this month's total and its change are in the summary at the top. */
export function SpendingSection({ model }: { model: DashboardModel }) {
  const router = useRouter();
  const [span, setSpan] = useState<RangeKey>(MONTHLY_DEFAULT_PERIOD);
  const months = usePeriodMonths(model, span);
  const phone = usePhone();

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
    return {
      buckets,
      empty: "Your monthly spending will appear here.",
      aria: `Spending in the last ${months.length} months`,
    };
  }, [months]);

  const { buckets } = view;
  const hasData = buckets.some((b) => b.expensesMinor > 0 || b.incomeMinor > 0);

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
      {!hasData ? (
        <EmptyChart height={phone ? 120 : 200}>{view.empty}</EmptyChart>
      ) : (
        <ColumnChart
          columns={columns}
          height={phone ? 170 : 230}
          animateKey={`${span}-${buckets.length}`}
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
