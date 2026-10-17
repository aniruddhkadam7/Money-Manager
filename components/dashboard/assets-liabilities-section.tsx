"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activityHref } from "@/lib/charts/links";
import { formatCompactINR, formatExactINR, formatHeadlineINR } from "@/lib/charts/format";
import { addDays, daysBetween } from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import { applyAnchorGapsToSeries } from "@/lib/finance/statement-anchor";
import { balanceSeries, DEFAULT_PERIOD, PERIODS, rangeStart, sampleDates, type RangeKey } from "@/lib/finance/series";
import { LineChart, type ChartSeries } from "../charts/line-chart";
import { ChartCard, Headline, RangeTabs } from "../charts/primitives";
import { TooltipCard, TooltipHint, TooltipRow, TooltipTitle } from "../charts/tooltip";
import { useFinance } from "../finance-provider";
import { useStatementGaps } from "../statements/use-statement-checks";
import { usePhone } from "../use-phone";
import { axisLabel, dateTitle, GAIN, LOSS } from "./chart-helpers";

const NET = "#64748b";

/** What I own against what I owe, over time: assets and liabilities as two lines, net worth dashed between them. */
export function AssetsLiabilitiesSection({ model }: { model: DashboardModel }) {
  const { book, ledger, today } = useFinance();
  // Bank balances as the latest statements say, like the net worth line in the summary.
  const gaps = useStatementGaps();
  const router = useRouter();
  const [range, setRange] = useState<RangeKey>(DEFAULT_PERIOD);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const phone = usePhone();

  const { dates, points } = useMemo(() => {
    const dates = sampleDates(rangeStart(range, today, model.firstActivity), today, 90);
    return { dates, points: applyAnchorGapsToSeries(balanceSeries(book, ledger, dates), gaps) };
  }, [book, ledger, today, range, model.firstActivity, gaps]);

  const xs = useMemo(() => dates.map((d) => daysBetween(dates[0], d)), [dates]);
  const series = useMemo<ChartSeries[]>(
    () => [
      { key: "assets", label: "Assets", color: GAIN, values: points.map((p) => p.assetsMinor), area: true },
      { key: "liabilities", label: "Liabilities", color: LOSS, values: points.map((p) => p.liabilitiesMinor) },
      { key: "net", label: "Net worth", color: NET, values: points.map((p) => p.netWorthMinor), dashed: true, strokeWidth: 2 },
    ],
    [points],
  );

  if (!model.firstActivity || points.length < 2) return null;
  const shown = points[hoverIdx ?? points.length - 1];
  const span = daysBetween(dates[0], dates[dates.length - 1]);

  return (
    <ChartCard title="Assets & liabilities" action={<RangeTabs label="Assets and liabilities range" value={range} options={PERIODS} onChange={setRange} />}>
      <Headline
        value={formatHeadlineINR(shown.netWorthMinor)}
        caption={`Own ${formatExactINR(shown.assetsMinor)} · owe ${formatExactINR(shown.liabilitiesMinor)}`}
      />
      <LineChart
        xs={xs}
        series={series}
        height={phone ? 180 : 240}
        includeZero
        animateKey={`${range}-${dates.length}`}
        ariaLabel="Assets and liabilities over time"
        formatY={formatCompactINR}
        xLabel={(i) => axisLabel(dates[i], span)}
        onSelect={(i) => router.push(activityHref({ from: i > 0 ? addDays(dates[i - 1], 1) : dates[i], to: dates[i] }))}
        selectLabel="See activity"
        onHoverChange={setHoverIdx}
        tooltip={(i) => {
          const p = points[i];
          const { title, sub } = dateTitle(p.date, today);
          return (
            <TooltipCard>
              <TooltipTitle sub={sub}>{title}</TooltipTitle>
              <TooltipRow label="Assets" value={formatExactINR(p.assetsMinor)} color={GAIN} />
              <TooltipRow label="Liabilities" value={formatExactINR(p.liabilitiesMinor)} color={LOSS} />
              <TooltipRow label="Net worth" value={formatExactINR(p.netWorthMinor)} color={NET} strong />
              <TooltipHint>Click to see activity</TooltipHint>
            </TooltipCard>
          );
        }}
      />
      <div className="mt-3 flex gap-5 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: GAIN }} />Assets</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: LOSS }} />Liabilities</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-3 border-t-2 border-dashed border-slate-500" />Net worth</span>
      </div>
    </ChartCard>
  );
}
