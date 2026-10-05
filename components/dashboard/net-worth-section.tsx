"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activityHref } from "@/lib/charts/links";
import { formatCompactINR, formatExactINR, formatHeadlineINR, formatSignedINR } from "@/lib/charts/format";
import { addDays, daysBetween, formatDayMonth, formatLongDayMonth, formatMonthYear } from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import { balanceSeries, rangeStart, sampleDates, type RangeKey } from "@/lib/finance/series";
import { LineChart, type ChartSeries } from "../charts/line-chart";
import { ChartCard, EmptyChart, Headline, RangeTabs } from "../charts/primitives";
import { TooltipCard, TooltipHint, TooltipRow, TooltipTitle } from "../charts/tooltip";
import { useFinance } from "../finance-provider";

export const GAIN = "#059669";
export const LOSS = "#e11d48";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "All" },
];

const SPAN_WORDS: Record<RangeKey, string> = {
  "1M": "in the last month",
  "3M": "in the last 3 months",
  "6M": "in the last 6 months",
  "1Y": "in the last year",
  "3Y": "in the last 3 years",
  ALL: "since you started",
};

/** Shared by the net worth and investment charts. */
export function dateTitle(date: string, today: string) {
  const year = date.slice(0, 4);
  return { title: formatLongDayMonth(date), sub: year === today.slice(0, 4) ? undefined : year };
}

export function axisLabel(date: string, spanDays: number) {
  return spanDays <= 75 ? formatDayMonth(date) : formatMonthYear(date.slice(0, 7));
}

export function NetWorthSection({ model }: { model: DashboardModel }) {
  const { book, ledger, today } = useFinance();
  const router = useRouter();
  const [range, setRange] = useState<RangeKey>("6M");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const data = useMemo(() => {
    const start = rangeStart(range, today, model.firstActivity);
    const dates = sampleDates(start, today, 90);
    return { dates, points: balanceSeries(book, ledger, dates) };
  }, [book, ledger, today, range, model.firstActivity]);

  const { dates, points } = data;
  const first = points[0];
  const last = points[points.length - 1];
  // While the cursor is on the chart, the headline shows that day instead of today.
  const shown = hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : last;
  const hovering = hoverIdx !== null && !!points[hoverIdx];
  const change = shown.netWorthMinor - first.netWorthMinor;
  const overall = last.netWorthMinor - first.netWorthMinor;
  const up = overall >= 0; // line colour reflects the whole range, not the hovered point
  const color = up ? GAIN : LOSS;
  const span = daysBetween(dates[0], dates[dates.length - 1]);
  const hasData = model.firstActivity !== null || points.some((p) => p.netWorthMinor !== 0);

  const xs = useMemo(() => dates.map((d) => daysBetween(dates[0], d)), [dates]);
  const series = useMemo<ChartSeries[]>(
    () => [{ key: "nw", label: "Net worth", color, values: points.map((p) => p.netWorthMinor), area: true }],
    [points, color],
  );

  return (
    <ChartCard title="Net worth" action={<RangeTabs label="Net worth range" value={range} options={RANGES} onChange={setRange} />}>
      <Headline
        value={formatHeadlineINR(shown.netWorthMinor)}
        delta={change === 0 ? "No change" : formatSignedINR(change, false)}
        tone={change === 0 ? "neutral" : up ? "positive" : "negative"}
        caption={
          hovering
            ? `On ${formatLongDayMonth(shown.date)}${shown.date.slice(0, 4) !== today.slice(0, 4) ? ` ${shown.date.slice(0, 4)}` : ""}, compared with the start of this range.`
            : change === 0
              ? `Your net worth hasn't changed ${SPAN_WORDS[range]}.`
              : `Your wealth is ${up ? "growing" : "shrinking"}: ${up ? "up" : "down"} ${formatExactINR(Math.abs(change))} ${SPAN_WORDS[range]}.`
        }
      />
      {!hasData ? (
        <EmptyChart height={220}>Your net worth history will appear here as you record what happens with your money.</EmptyChart>
      ) : (
        <LineChart
          xs={xs}
          series={series}
          height={250}
          animateKey={`${range}-${dates.length}-${last.netWorthMinor}`}
          ariaLabel={`Net worth over ${SPAN_WORDS[range]}`}
          formatY={formatCompactINR}
          xLabel={(i) => axisLabel(dates[i], span)}
          onSelect={(i) => router.push(activityHref({ from: i > 0 ? addDays(dates[i - 1], 1) : dates[i], to: dates[i] }))}
          selectLabel="See what changed"
          onHoverChange={setHoverIdx}
          tooltip={(i) => {
            const p = points[i];
            const { title, sub } = dateTitle(p.date, today);
            return (
              <TooltipCard>
                <TooltipTitle sub={sub}>{title}</TooltipTitle>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Net worth</p>
                <p className="mb-2 text-xl font-semibold tabular-nums">{formatExactINR(p.netWorthMinor)}</p>
                <TooltipRow label="Assets" value={formatExactINR(p.assetsMinor)} />
                <TooltipRow label="Liabilities" value={formatExactINR(p.liabilitiesMinor)} />
                <TooltipHint>Click to see what changed</TooltipHint>
              </TooltipCard>
            );
          }}
        />
      )}
    </ChartCard>
  );
}
