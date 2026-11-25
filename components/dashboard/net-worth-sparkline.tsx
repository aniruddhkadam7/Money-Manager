"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { formatCompactINR, formatExactINR } from "@/lib/charts/format";
import { areaPath, monotonePath } from "@/lib/charts/path";
import { linearScale, nearestIndex, niceTicks } from "@/lib/charts/scale";
import { addDays, daysBetween, formatLongDayMonth } from "@/lib/domain/dates";
import { applyAnchorGapsToSeries } from "@/lib/finance/statement-anchor";
import { balanceSeries, DEFAULT_PERIOD, PERIODS, periodWords, rangeStart, sampleDates, type RangeKey } from "@/lib/finance/series";
import { cn } from "@/lib/utils";
import { RangeTabs } from "../charts/primitives";
import { useWidth } from "../charts/use-width";
import { useFinance } from "../finance-provider";
import { useStatementGaps } from "../statements/use-statement-checks";
import { axisLabel, GAIN, LOSS } from "./chart-helpers";
import { useSessionState } from "@/lib/use-session-state";

const HEIGHT = 120;
const PAD = 6;
/** Room on the left for the ₹ amounts of the scale. */
const AXIS = 46;

/**
 * A small line of net worth over a chosen span, under the headline number. It starts from where you stood just
 * before the span (the end of last month for "This month", as the change pill above counts it), so the line, its
 * colour and the pill tell the same story. A ₹ scale with grid lines (₹0 marked) sits on the left, the start and today's
 * values are printed under it, and a tap or hover shows any day.
 */
export function NetWorthSparkline({ firstActivity }: { firstActivity: string | null }) {
  const { book, ledger, today } = useFinance();
  const gaps = useStatementGaps();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useSessionState<RangeKey>("networth:range", DEFAULT_PERIOD);
  const words = periodWords(range).replace(/^./, (c) => c.toUpperCase());

  const points = useMemo(() => {
    // The day before the span: its closing net worth is the starting point, so the span's first day's entries show as a move.
    const dates = sampleDates(addDays(rangeStart(range, today, firstActivity), -1), today, 60);
    return applyAnchorGapsToSeries(balanceSeries(book, ledger, dates), gaps);
  }, [book, ledger, today, firstActivity, range, gaps]);

  const layout = useMemo(() => {
    if (!width || points.length < 2) return null;
    const values = points.map((p) => p.netWorthMinor);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const xs = points.map((p) => daysBetween(points[0].date, p.date));
    const x = linearScale(0, xs[xs.length - 1], AXIS, width - PAD);
    // Round amounts for the scale, stretched to cover every value: three or four lines, ₹0 among them when crossed.
    let ticks: number[];
    if (max === min) {
      ticks = [min];
    } else {
      const rough = niceTicks(min, max, 3);
      const step = rough.length > 1 ? rough[1] - rough[0] : max - min;
      const lo = Math.floor(min / step) * step;
      const hi = Math.ceil(max / step) * step;
      ticks = [];
      for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    }
    const lo = max === min ? min - 1 : ticks[0];
    const hi = max === min ? min + 1 : ticks[ticks.length - 1];
    const y = linearScale(lo, hi, HEIGHT - PAD, PAD);
    const pts = points.map((p, i) => ({ x: x(xs[i]), y: y(p.netWorthMinor) }));
    // The fill runs to ₹0 when it's on the scale, so money you have and money you're short read differently.
    const baseY = lo <= 0 && hi >= 0 ? y(0) : HEIGHT - PAD;
    return { xs, x, pts, ticks: ticks.map((v) => ({ v, y: y(v) })), baseY };
  }, [points, width]);

  if (!firstActivity || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.netWorthMinor - first.netWorthMinor;
  const color = delta >= 0 ? GAIN : LOSS;
  const shown = hover !== null ? points[hover] : null;
  const span = daysBetween(first.date, last.date);
  const ticks = [first.date, points[Math.floor((points.length - 1) / 2)].date, last.date];
  const dayWords = (d: string) => `${formatLongDayMonth(d)}${d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : ""}`;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!layout) return;
    const box = e.currentTarget.getBoundingClientRect();
    const day = (e.clientX - box.left - AXIS) / Math.max(1, box.width - AXIS - PAD) * layout.xs[layout.xs.length - 1];
    setHover(nearestIndex(layout.xs, day));
  };

  return (
    <div className="mt-2 w-full sm:mt-3 lg:w-80" data-testid="net-worth-sparkline">
      <div className="mb-2 flex items-center justify-end gap-2">
        <RangeTabs label="Net worth timeline" value={range} options={PERIODS} onChange={(v) => { setRange(v); setHover(null); }} />
      </div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-slate-400">
        {shown ? (
          <>
            <span>{shown.date === today ? "Today" : dayWords(shown.date)}</span>
            <span className="font-medium text-slate-700">{formatExactINR(shown.netWorthMinor)}</span>
          </>
        ) : (
          <>
            <span>{words}</span>
            <span className={delta > 0 ? "font-medium text-emerald-600" : delta < 0 ? "font-medium text-rose-600" : "text-slate-500"}>
              {delta === 0 ? "No change" : `${delta > 0 ? "Up" : "Down"} ${formatExactINR(Math.abs(delta))}`}
            </span>
          </>
        )}
      </div>
      <div ref={ref} className="relative" style={{ height: HEIGHT }}>
        {layout && (
          <svg
            width={width}
            height={HEIGHT}
            className="block touch-pan-y overflow-visible"
            role="img"
            aria-label={`Net worth, ${words.toLowerCase()}: from ${formatExactINR(first.netWorthMinor)} on ${formatLongDayMonth(first.date)} to ${formatExactINR(last.netWorthMinor)} today.`}
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="nw-spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {layout.ticks.map(({ v, y }) => (
              <g key={v}>
                <line x1={AXIS} x2={width - PAD} y1={y} y2={y} className={v === 0 ? "stroke-slate-400" : "stroke-slate-200"} strokeDasharray={v === 0 ? undefined : "2 4"} strokeWidth={1} />
                <text x={AXIS - 6} y={y} dy="0.32em" textAnchor="end" className={cn("text-[10px] tabular-nums", v === 0 ? "fill-slate-500 font-medium" : "fill-slate-400")}>
                  {v === 0 ? "₹0" : formatCompactINR(v)}
                </text>
              </g>
            ))}
            <path d={areaPath(layout.pts, layout.baseY)} fill="url(#nw-spark-fill)" />
            <path d={monotonePath(layout.pts)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {hover !== null ? (
              <>
                <line x1={layout.pts[hover].x} x2={layout.pts[hover].x} y1={PAD} y2={HEIGHT - PAD} className="stroke-slate-400" strokeWidth={1} />
                <circle cx={layout.pts[hover].x} cy={layout.pts[hover].y} r={4} fill={color} className="stroke-card" strokeWidth={2} />
              </>
            ) : (
              <circle cx={layout.pts[layout.pts.length - 1].x} cy={layout.pts[layout.pts.length - 1].y} r={3} fill={color} className="stroke-card" strokeWidth={2} />
            )}
          </svg>
        )}
      </div>
      {/* Dates along the bottom; under the ends, what net worth was then and is now. */}
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-400" style={{ paddingLeft: AXIS - PAD }} aria-hidden>
        {ticks.map((d, i) => (
          <span key={i} className={cn("flex flex-col", i === 2 && "items-end")}>
            <span>{i === 2 ? "Today" : axisLabel(d, span)}</span>
            {i !== 1 && (
              <span className={cn("text-[11px] font-medium", i === 2 ? "text-slate-700" : "text-slate-500")}>
                {formatCompactINR((i === 0 ? first : last).netWorthMinor)}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
