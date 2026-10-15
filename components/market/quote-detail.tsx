"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isFund } from "@/lib/market/funds";
import { axisTime, formatAxis, formatChange, formatPct, formatPrice, formatQuoteReturn, pointTime, toneOf, updatedAt } from "@/lib/market/format";
import { FUND_RANGES, PERIODS, RANGES, type MarketRange, type Quote } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { LineChart, type ChartSeries } from "../charts/line-chart";
import { DeltaPill, EmptyChart, RangeTabs } from "../charts/primitives";
import { TooltipCard, TooltipRow, TooltipTitle } from "../charts/tooltip";
import { GAIN, LOSS } from "../dashboard/chart-helpers";
import { useChart } from "./use-market";

const RANGE_WORDS: Record<MarketRange, string> = { "1d": "today", "5d": "5 days", "1mo": "1 month", "6mo": "6 months", "1y": "1 year", "5y": "5 years" };

/** One instrument up close: its price, a chart over a chosen range, and the day's numbers. */
export function QuoteDetail({ quote, onClose }: { quote: Quote | null; onClose: () => void }) {
  return (
    <Dialog open={!!quote} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl [&>*]:min-w-0">{quote && <Detail key={quote.symbol} quote={quote} />}</DialogContent>
    </Dialog>
  );
}

function Detail({ quote }: { quote: Quote }) {
  const fund = isFund(quote.symbol);
  // One price a day (funds, IBJA's bullion rates): no chart through the day, dates without times.
  const daily = fund || !!quote.daily;
  const ranges = daily ? FUND_RANGES : RANGES;
  // Not for trading: the year shows how it's really been doing.
  const [range, setRange] = useState<MarketRange>("1y");
  const [hover, setHover] = useState<number | null>(null);
  const { data, loading, error } = useChart(quote.symbol, range);

  const points = useMemo(() => data?.points ?? [], [data]);
  const first = range === "1d" ? (data?.prevClose ?? quote.prevClose) : points[0]?.v;
  const lastV = points.at(-1)?.v ?? quote.price;
  const shown = hover !== null && points[hover] ? points[hover].v : range === "1d" ? quote.price : lastV;
  const change = first !== undefined ? shown - first : 0;
  const pct = first ? (change / first) * 100 : 0;
  const color = lastV >= (first ?? lastV) ? GAIN : LOSS;

  const series = useMemo<ChartSeries[]>(() => {
    const s: ChartSeries[] = [{ key: "price", label: "Price", color, values: points.map((p) => p.v), area: true }];
    if (range === "1d" && data?.prevClose)
      s.push({ key: "prev", label: "Previous close", color: "#94a3b8", values: points.map(() => data.prevClose!), dashed: true, strokeWidth: 1.5 });
    return s;
  }, [points, color, range, data]);
  // Evenly spaced, like a trading chart: nights and weekends don't leave flat gaps.
  const xs = useMemo(() => points.map((_, i) => i), [points]);
  const tz = data?.timezone ?? quote.timezone;

  const stats: [string, string][] = [
    [fund ? "Previous NAV" : quote.daily ? "Previous rate" : "Previous close", formatPrice(quote.prevClose, quote)],
    ...(quote.yearHigh !== null ? [["52-week high", formatPrice(quote.yearHigh, quote)] as [string, string]] : []),
    ...(quote.yearLow !== null ? [["52-week low", formatPrice(quote.yearLow, quote)] as [string, string]] : []),
    ["Updated", updatedAt(quote.time)],
  ];

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle className="leading-snug">{quote.name}</DialogTitle>
        <DialogDescription>
          {fund ? "Mutual fund" : quote.symbol}
          {quote.exchange && ` · ${quote.exchange}`}
        </DialogDescription>
      </DialogHeader>

      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-slate-900">
            {formatPrice(shown, quote)}
            {quote.unit && <span className="ml-1 text-sm font-medium text-slate-500">/ {quote.unit}</span>}
          </p>
          <DeltaPill tone={toneOf(change)}>
            {formatChange(change)} ({formatPct(pct)})
          </DeltaPill>
        </div>
        <p className="mt-1.5 text-[13px] text-slate-500">
          {hover !== null && points[hover] ? pointTime(points[hover].t, range, tz, daily) : range === "1d" ? (fund ? "Since the NAV before" : "Since yesterday's close") : `Over ${RANGE_WORDS[range]}`}
        </p>
        {quote.note && <p className="mt-1 text-xs text-slate-500">{quote.note}</p>}
      </div>

      <div className="grid gap-3">
        {loading ? (
          <div className="h-[240px] animate-pulse rounded-2xl bg-slate-100" aria-busy />
        ) : error || points.length < 2 ? (
          <EmptyChart height={240}>{error ? "Couldn't load this chart. Try again in a minute." : "No prices for this range yet."}</EmptyChart>
        ) : (
          <LineChart
            xs={xs}
            series={series}
            height={240}
            ariaLabel={`${quote.name} price over ${RANGE_WORDS[range]}`}
            animateKey={`${quote.symbol}-${range}`}
            xLabel={(i) => axisTime(points[i].t, range, tz)}
            formatY={formatAxis}
            onHoverChange={setHover}
            tooltip={(i) => (
              <TooltipCard>
                <TooltipTitle>{pointTime(points[i].t, range, tz, daily)}</TooltipTitle>
                <TooltipRow label="Price" value={formatPrice(points[i].v, quote)} color={color} strong />
                {first !== undefined && (
                  <TooltipRow label="Change" value={formatPct(((points[i].v - first) / first) * 100)} tone={points[i].v >= first ? "positive" : "negative"} />
                )}
              </TooltipCard>
            )}
          />
        )}
        {/* Under the chart, as market apps put it; across the full width on phones, so each range is easy to hit. */}
        <div className="max-sm:[&>[role=tablist]]:flex max-sm:[&_button]:flex-1">
          <RangeTabs label="Chart range" value={range} options={ranges} onChange={setRange} />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1 rounded-2xl bg-slate-50 p-1.5 text-center">
        {PERIODS.map((p) => {
          const v = quote.perf[p.value];
          return (
            <div key={p.value} className="rounded-xl px-1 py-1.5">
              <p className="text-[11px] font-medium text-slate-500">{p.label}</p>
              <p className={cn("text-sm font-semibold tabular-nums", v === null ? "text-slate-400" : v >= 0 ? "text-emerald-700" : "text-rose-700")}>{formatQuoteReturn(quote, v)}</p>
            </div>
          );
        })}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 border-b border-slate-100 pb-1.5 sm:block sm:border-0 sm:pb-0">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-medium tabular-nums text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
