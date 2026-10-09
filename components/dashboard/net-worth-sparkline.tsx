"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { formatExactINR } from "@/lib/charts/format";
import { areaPath, monotonePath } from "@/lib/charts/path";
import { linearScale, nearestIndex } from "@/lib/charts/scale";
import { daysBetween, formatLongDayMonth } from "@/lib/domain/dates";
import { balanceSeries, DEFAULT_PERIOD, PERIODS, periodWords, rangeStart, sampleDates, type RangeKey } from "@/lib/finance/series";
import { RangeTabs } from "../charts/primitives";
import { useWidth } from "../charts/use-width";
import { useFinance } from "../finance-provider";
import { axisLabel, GAIN, LOSS } from "./net-worth-section";

const HEIGHT = 56;
const PAD = 4;

/** A small line of net worth over a chosen span, under the headline number. Tap or hover for a day's value. */
export function NetWorthSparkline({ firstActivity }: { firstActivity: string | null }) {
  const { book, ledger, today } = useFinance();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>(DEFAULT_PERIOD);
  const words = periodWords(range).replace(/^./, (c) => c.toUpperCase());

  const points = useMemo(() => {
    const dates = sampleDates(rangeStart(range, today, firstActivity), today, 60);
    return balanceSeries(book, ledger, dates);
  }, [book, ledger, today, firstActivity, range]);

  const layout = useMemo(() => {
    if (!width || points.length < 2) return null;
    const values = points.map((p) => p.netWorthMinor);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const xs = points.map((p) => daysBetween(points[0].date, p.date));
    const x = linearScale(0, xs[xs.length - 1], PAD, width - PAD);
    const y = linearScale(min, max === min ? min + 1 : max, HEIGHT - PAD, PAD);
    const pts = points.map((p, i) => ({ x: x(xs[i]), y: max === min ? HEIGHT / 2 : y(p.netWorthMinor) }));
    const zeroY = min < 0 && max > 0 ? y(0) : null;
    return { xs, x, pts, zeroY };
  }, [points, width]);

  if (!firstActivity || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const color = last.netWorthMinor >= first.netWorthMinor ? GAIN : LOSS;
  const shown = hover !== null ? points[hover] : null;
  const span = daysBetween(first.date, last.date);
  const ticks = [first.date, points[Math.floor((points.length - 1) / 2)].date, last.date];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!layout) return;
    const box = e.currentTarget.getBoundingClientRect();
    const day = (e.clientX - box.left - PAD) / Math.max(1, box.width - 2 * PAD) * layout.xs[layout.xs.length - 1];
    setHover(nearestIndex(layout.xs, day));
  };

  return (
    <div className="mt-3 w-full lg:w-80" data-testid="net-worth-sparkline">
      <div className="mb-2 flex items-center justify-between gap-2">
        <RangeTabs label="Net worth timeline" value={range} options={PERIODS} onChange={(v) => { setRange(v); setHover(null); }} />
      </div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-slate-400">
        <span>{shown ? `${formatLongDayMonth(shown.date)}${shown.date.slice(0, 4) !== today.slice(0, 4) ? ` ${shown.date.slice(0, 4)}` : ""}` : words}</span>
        {shown && <span className="font-medium text-slate-700">{formatExactINR(shown.netWorthMinor)}</span>}
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
            {layout.zeroY !== null && <line x1={PAD} x2={width - PAD} y1={layout.zeroY} y2={layout.zeroY} className="stroke-slate-300" strokeDasharray="3 3" strokeWidth={1} />}
            <path d={areaPath(layout.pts, HEIGHT)} fill="url(#nw-spark-fill)" />
            <path d={monotonePath(layout.pts)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {hover !== null ? (
              <>
                <line x1={layout.pts[hover].x} x2={layout.pts[hover].x} y1={0} y2={HEIGHT} className="stroke-slate-400" strokeWidth={1} />
                <circle cx={layout.pts[hover].x} cy={layout.pts[hover].y} r={4} fill={color} className="stroke-card" strokeWidth={2} />
              </>
            ) : (
              <circle cx={layout.pts[layout.pts.length - 1].x} cy={layout.pts[layout.pts.length - 1].y} r={3} fill={color} className="stroke-card" strokeWidth={2} />
            )}
          </svg>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-400" aria-hidden>
        {ticks.map((d, i) => (
          <span key={i}>{i === 2 ? "Today" : axisLabel(d, span)}</span>
        ))}
      </div>
    </div>
  );
}
