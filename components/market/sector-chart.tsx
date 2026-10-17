"use client";

import { useMemo, useState } from "react";
import { daysBetween } from "@/lib/domain/dates";
import { formatPct } from "@/lib/market/format";
import type { HistoryRange } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { LineChart, type ChartSeries } from "../charts/line-chart";
import { EmptyChart, RangeTabs } from "../charts/primitives";
import { TooltipCard, TooltipRow, TooltipTitle } from "../charts/tooltip";
import { axisLabel, dateTitle } from "../dashboard/chart-helpers";
import { usePhone } from "../use-phone";
import { tone } from "./tone";
import { useSectorHistory } from "./use-market";

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
  { value: "5Y", label: "5Y" },
];

/** Colour slots (--sector-1…5 in globals.css, validated for colour-blind separation in both themes). */
const SLOTS = 5;
const DEFAULT = ["^NSEBANK", "^CNXIT", "^CNXPHARMA", "^CNXAUTO", "^CNXFMCG"];

/**
 * Sectors side by side: each line is how far a sector has moved since the start of the span, so indices at very
 * different levels share one axis. Up to five at once; the list underneath picks them and doubles as the legend.
 * A sector keeps its colour while it stays picked.
 */
export function SectorChart() {
  const [range, setRange] = useState<HistoryRange>("1Y");
  const { data, status, retry } = useSectorHistory(range);
  const phone = usePhone();
  // Symbol → colour slot, in the order they were picked.
  const [picked, setPicked] = useState<Map<string, number>>(() => new Map(DEFAULT.map((s, i) => [s, i + 1])));
  const today = new Date().toISOString().slice(0, 10);

  const sectors = useMemo(
    () =>
      (data?.sectors ?? [])
        .map((s) => ({ ...s, returns: s.closes.map((c) => (c / s.closes[0] - 1) * 100) }))
        .sort((a, b) => b.returns[b.returns.length - 1] - a.returns[a.returns.length - 1]),
    [data],
  );
  const dates = useMemo(() => data?.dates ?? [], [data]);
  const xs = useMemo(() => dates.map((d) => daysBetween(dates[0], d)), [dates]);
  const series = useMemo<ChartSeries[]>(
    () =>
      sectors
        .filter((s) => picked.has(s.symbol))
        .map((s) => ({ key: s.symbol, label: s.name, color: `var(--sector-${picked.get(s.symbol)})`, values: s.returns, strokeWidth: 2 })),
    [sectors, picked],
  );

  const toggle = (symbol: string) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(symbol)) next.delete(symbol);
      else {
        const used = new Set(next.values());
        const slot = Array.from({ length: SLOTS }, (_, i) => i + 1).find((n) => !used.has(n));
        if (slot) next.set(symbol, slot);
      }
      return next;
    });

  const span = dates.length ? daysBetween(dates[0], dates[dates.length - 1]) : 0;
  const full = picked.size >= SLOTS;

  return (
    <section className="rounded-3xl border glass p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">Sectors compared</h2>
        <RangeTabs label="Sector chart range" value={range} options={RANGES} onChange={setRange} />
      </div>

      {!data ? (
        status === "error" ? (
          <EmptyChart height={phone ? 200 : 280}>
            Couldn&apos;t load sector history.{" "}
            <button type="button" onClick={retry} className="font-medium text-emerald-700 hover:underline">
              Try again
            </button>
          </EmptyChart>
        ) : (
          <div className="animate-pulse rounded-2xl bg-slate-100" style={{ height: phone ? 200 : 280 }} aria-busy />
        )
      ) : series.length === 0 ? (
        <EmptyChart height={phone ? 200 : 280}>Pick a sector below to draw its line.</EmptyChart>
      ) : (
        <LineChart
          xs={xs}
          series={series}
          height={phone ? 200 : 280}
          includeZero
          animateKey={`${range}-${dates.length}-${[...picked.keys()].join()}`}
          ariaLabel={`Sector returns over ${range}: ${series.map((s) => `${s.label} ${formatPct(s.values[s.values.length - 1], 1)}`).join(", ")}`}
          formatY={(v) => formatPct(v, 0)}
          xLabel={(i) => axisLabel(dates[i], span)}
          tooltip={(i, all) => {
            const { title, sub } = dateTitle(dates[i], today);
            return (
              <TooltipCard>
                <TooltipTitle sub={sub}>{title}</TooltipTitle>
                {[...all]
                  .sort((a, b) => b.values[i] - a.values[i])
                  .map((s) => (
                    <TooltipRow key={s.key} label={s.label} value={formatPct(s.values[i], 1)} color={s.color} tone={s.values[i] >= 0 ? "positive" : "negative"} />
                  ))}
              </TooltipCard>
            );
          }}
        />
      )}

      {data && (
        <>
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Sectors to show">
            {sectors.map((s) => {
              const slot = picked.get(s.symbol);
              const r = s.returns[s.returns.length - 1];
              return (
                <li key={s.symbol}>
                  <button
                    type="button"
                    aria-pressed={!!slot}
                    disabled={!slot && full}
                    onClick={() => toggle(s.symbol)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40",
                      slot ? "border-slate-300 bg-card font-medium text-slate-900 shadow-sm" : "border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200/70",
                    )}
                  >
                    <span className={cn("size-2 rounded-full", !slot && "bg-slate-300")} style={slot ? { backgroundColor: `var(--sector-${slot})` } : undefined} />
                    {s.name}
                    <span className={cn("tabular-nums", tone(r))}>
                      {s.rebuilt && "≈"}
                      {formatPct(r, 1)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">
            Change since the start of the span, best to worst. Pick up to {SLOTS} sectors{full ? " (unpick one to add another)" : ""}.
            {sectors.some((s) => s.rebuilt) &&
              " ≈ Yahoo keeps no past prices for these sector indices, so their lines are rebuilt from each sector's 15 largest companies: close to the real index, not exact."}
          </p>
        </>
      )}
    </section>
  );
}
