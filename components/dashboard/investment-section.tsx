"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { activityHref } from "@/lib/charts/links";
import { formatBps, formatCompactINR, formatExactINR, formatHeadlineINR, formatSignedINR } from "@/lib/charts/format";
import { addDays, daysBetween } from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import { balanceSeries, DEFAULT_PERIOD, PERIODS, rangeStart, sampleDates, type RangeKey } from "@/lib/finance/series";
import { LineChart, type ChartSeries } from "../charts/line-chart";
import { ChartCard, EmptyChart, Headline, RangeTabs } from "../charts/primitives";
import { TooltipCard, TooltipHint, TooltipRow, TooltipTitle } from "../charts/tooltip";
import { useEventDialog } from "../events/event-dialog";
import { useFinance } from "../finance-provider";
import { axisLabel, dateTitle, GAIN, LOSS } from "./net-worth-section";

/** Are my investments growing? Value over time against what I put in. */
export function InvestmentSection({ model }: { model: DashboardModel }) {
  const { book, ledger, state, today } = useFinance();
  const router = useRouter();
  const { openAdd } = useEventDialog();
  const [range, setRange] = useState<RangeKey>(DEFAULT_PERIOD);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { dates, points } = useMemo(() => {
    const dates = sampleDates(rangeStart(range, today, model.firstActivity), today, 90);
    return { dates, points: balanceSeries(book, ledger, dates) };
  }, [book, ledger, today, range, model.firstActivity]);

  const xs = useMemo(() => dates.map((d) => daysBetween(dates[0], d)), [dates]);
  const hp = hoverIdx !== null ? points[hoverIdx] : undefined;
  const value = hp ? hp.investmentsMinor : state.investments.valueMinor;
  const invested = hp ? hp.investedMinor : state.investments.costBasisMinor;
  const gain = value - invested;
  const pctBps = invested > 0 ? Math.round((gain / invested) * 10_000) : null;
  const color = state.investments.valueMinor - state.investments.costBasisMinor >= 0 ? GAIN : LOSS;
  const hasInvestments = points.some((p) => p.investmentsMinor !== 0 || p.investedMinor !== 0);
  const span = daysBetween(dates[0], dates[dates.length - 1]);

  const series = useMemo<ChartSeries[]>(
    () => [
      { key: "value", label: "Portfolio value", color, values: points.map((p) => p.investmentsMinor), area: true },
      { key: "invested", label: "Invested", color: "#94a3b8", values: points.map((p) => p.investedMinor), dashed: true, strokeWidth: 2 },
    ],
    [points, color],
  );

  return (
    <ChartCard title="Investments" action={<RangeTabs label="Investment range" value={range} options={PERIODS} onChange={setRange} />}>
      <Headline
        value={formatHeadlineINR(value)}
        delta={invested > 0 ? `${formatSignedINR(gain, false)}${pctBps !== null ? ` (${pctBps >= 0 ? "+" : "−"}${formatBps(Math.abs(pctBps), 1)})` : ""}` : undefined}
        tone={gain === 0 ? "neutral" : gain > 0 ? "positive" : "negative"}
        caption={
          invested > 0
            ? `Put in ${formatExactINR(invested)} · ${gain >= 0 ? "up" : "down"} ${formatExactINR(Math.abs(gain))}`
            : "Current value"
        }
      />
      {!hasInvestments ? (
        <EmptyChart height={200}>
          <span className="block">Record an investment to watch it grow here.</span>
          <button onClick={() => openAdd("invest")} className="mt-3 font-medium text-emerald-700 hover:underline">
            Add an investment
          </button>
        </EmptyChart>
      ) : (
        <LineChart
          xs={xs}
          series={series}
          height={220}
          includeZero
          animateKey={`${range}-${dates.length}-${value}`}
          ariaLabel="Investment value over time"
          formatY={formatCompactINR}
          xLabel={(i) => axisLabel(dates[i], span)}
          onSelect={(i) => router.push(activityHref({ group: "investments", from: i > 0 ? addDays(dates[i - 1], 1) : dates[i], to: dates[i] }))}
          selectLabel="See investment activity"
          onHoverChange={setHoverIdx}
          tooltip={(i) => {
            const p = points[i];
            const g = p.investmentsMinor - p.investedMinor;
            const { title, sub } = dateTitle(p.date, today);
            return (
              <TooltipCard>
                <TooltipTitle sub={sub}>{title}</TooltipTitle>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Portfolio value</p>
                <p className="mb-2 text-xl font-semibold tabular-nums">{formatExactINR(p.investmentsMinor)}</p>
                <TooltipRow label="Invested" value={formatExactINR(p.investedMinor)} color="#94a3b8" />
                <TooltipRow label={g >= 0 ? "Gain" : "Loss"} value={formatExactINR(Math.abs(g))} tone={g >= 0 ? "positive" : "negative"} strong />
                <TooltipHint>Click to see investment activity</TooltipHint>
              </TooltipCard>
            );
          }}
        />
      )}
      {hasInvestments && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span className="flex gap-5">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: color }} />Value</span>
            <span className="flex items-center gap-1.5"><span className="h-0 w-3 border-t-2 border-dashed border-slate-400" />Invested</span>
          </span>
          <button type="button" onClick={() => openAdd("update_valuation")} className="font-medium text-emerald-700 hover:underline">Update value</button>
        </div>
      )}
    </ChartCard>
  );
}
