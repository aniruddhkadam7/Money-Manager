"use client";

import { useState, type PointerEvent } from "react";
import type { Zone } from "@/lib/market/health";
import type { YearValue } from "@/lib/market/types";
import { useWidth } from "../charts/use-width";

const FILL = { good: "#10b981", watch: "#f59e0b", weak: "#f43f5e" } as const;
const NEUTRAL = "#94a3b8";

const zoneOf = (zones: Zone[], v: number) => zones.find((z) => v >= z.from && v < z.to)?.verdict;

/**
 * A figure year by year: a bar per year, coloured by the range it falls in; actual years solid, the
 * IMF's estimate and forecast faded with a dashed edge; the healthy range shaded behind; the world's
 * figure as a thin line to compare. Tap or hover a year to pick it.
 */
export function YearBars({
  series,
  world,
  zones,
  format,
  picked,
  onPick,
  greyFrom,
  height = 112,
}: {
  series: YearValue[];
  world?: YearValue[];
  zones: Zone[];
  format: (v: number) => string;
  picked: number;
  onPick: (index: number) => void;
  /** Years from this one on are drawn grey: figures carried forward, not measured. */
  greyFrom?: number;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [touching, setTouching] = useState(false);
  const pad = { top: 18, bottom: 16, x: 2 };
  const n = series.length;
  const worldBy = new Map((world ?? []).map((w) => [w.year, w.value]));

  // The scale covers the bars, the world's line, zero, and the edges of the healthy range near the data.
  const data = [...series.map((s) => s.value), ...series.flatMap((s) => (worldBy.has(s.year) ? [worldBy.get(s.year)!] : []))];
  let lo = Math.min(0, ...data);
  let hi = Math.max(0, ...data);
  const span = hi - lo || 1;
  for (const z of zones) {
    for (const edge of [z.from, z.to]) {
      if (Number.isFinite(edge) && edge >= lo - span * 0.6 && edge <= hi + span * 0.6) {
        lo = Math.min(lo, edge);
        hi = Math.max(hi, edge);
      }
    }
  }
  hi += (hi - lo) * 0.08;
  if (lo < 0) lo -= (hi - lo) * 0.06;
  const innerH = height - pad.top - pad.bottom;
  const y = (v: number) => pad.top + ((hi - v) / (hi - lo)) * innerH;
  const slot = n ? (width - pad.x * 2) / n : 0;
  const barW = Math.min(26, slot * 0.62);
  const cx = (i: number) => pad.x + slot * i + slot / 2;

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (!slot) return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - pad.x) / slot)));
    if (i !== picked) onPick(i);
  };

  const good = zones.filter((z) => z.verdict === "good");
  const edges = [...new Set(good.flatMap((z) => [z.from, z.to]).filter((v) => Number.isFinite(v) && v > lo && v < hi))];
  const worldPts = series.map((s, i) => (worldBy.has(s.year) ? { x: cx(i), y: y(worldBy.get(s.year)!) } : null)).filter((p): p is { x: number; y: number } => p !== null);

  return (
    <div ref={ref} className="relative select-none" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block touch-pan-y"
          role="img"
          aria-label={series.map((s) => `${s.year}${s.forecast ? " (IMF forecast)" : ""}: ${format(s.value)}`).join(", ")}
          onPointerDown={(e) => {
            setTouching(true);
            pick(e);
          }}
          onPointerMove={(e) => (touching || e.pointerType === "mouse") && pick(e)}
          onPointerUp={() => setTouching(false)}
          onPointerLeave={() => setTouching(false)}
        >
          {/* The healthy range, shaded, with its edges dashed. */}
          {good.map((z, k) => {
            const top = y(Math.min(z.to, hi));
            const bottom = y(Math.max(z.from, lo));
            return bottom > top ? <rect key={k} x={0} width={width} y={top} height={bottom - top} fill={FILL.good} opacity={0.09} /> : null;
          })}
          {edges.map((v) => (
            <line key={v} x1={0} x2={width} y1={y(v)} y2={y(v)} stroke={FILL.good} strokeOpacity={0.5} strokeDasharray="3 3" />
          ))}
          {lo < 0 && <line x1={0} x2={width} y1={y(0)} y2={y(0)} className="stroke-slate-300" />}

          {series.map((s, i) => {
            const color = zones.length && !(greyFrom !== undefined && s.year >= greyFrom) ? FILL[zoneOf(zones, s.value) ?? "watch"] : NEUTRAL;
            const top = y(Math.max(s.value, 0));
            const h = Math.max(1.5, Math.abs(y(s.value) - y(0)));
            const on = i === picked;
            return (
              <g key={s.year}>
                <rect
                  x={cx(i) - barW / 2}
                  y={top}
                  width={barW}
                  height={h}
                  rx={3}
                  fill={color}
                  fillOpacity={s.forecast ? 0.28 : on ? 1 : 0.75}
                  stroke={s.forecast ? color : "none"}
                  strokeDasharray={s.forecast ? "3 2" : undefined}
                  strokeWidth={s.forecast ? 1.2 : 0}
                />
                <text x={cx(i)} y={height - 3} textAnchor="middle" className={on ? "fill-slate-900 text-[10px] font-semibold" : "fill-slate-400 text-[10px]"}>
                  {`’${String(s.year).slice(2)}`}
                </text>
              </g>
            );
          })}

          {worldPts.length > 1 && (
            <polyline points={worldPts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" className="stroke-slate-500" strokeWidth={1.4} strokeLinejoin="round" />
          )}
          {worldPts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={2} className="fill-slate-500" />
          ))}

          {/* The picked year's figure, over its bar. */}
          {series[picked] && (
            <text
              x={Math.min(Math.max(cx(picked), 18), width - 18)}
              y={Math.max(11, y(Math.max(series[picked].value, 0)) - 5)}
              textAnchor="middle"
              className="fill-slate-900 text-[10px] font-semibold"
            >
              {format(series[picked].value)}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}
