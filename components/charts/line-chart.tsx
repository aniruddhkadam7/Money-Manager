"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { areaPath, monotonePath } from "@/lib/charts/path";
import { linearScale, nearestIndex, niceTicks, spreadIndexes } from "@/lib/charts/scale";
import { useWidth } from "./use-width";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** Soft gradient fill under the line. */
  area?: boolean;
  dashed?: boolean;
  strokeWidth?: number;
}

interface Props {
  /** Numeric x position of each point (e.g. day number); ascending. */
  xs: number[];
  series: ChartSeries[];
  /** Short axis label for the point at this index. */
  xLabel: (index: number) => string;
  /** Axis label for a y value. */
  formatY: (value: number) => string;
  /** Content of the hover card for the point at this index. */
  tooltip: (index: number, series: ChartSeries[]) => ReactNode;
  /** Click (mouse) or "view" button (touch) on a point. */
  onSelect?: (index: number) => void;
  selectLabel?: string;
  /** Called as the pointer moves over points (null when it leaves). */
  onHoverChange?: (index: number | null) => void;
  height?: number;
  ariaLabel: string;
  /** Changing this replays the draw-in animation (e.g. when the range changes). */
  animateKey: string;
  includeZero?: boolean;
}

/**
 * A smooth, quiet line/area chart with a crosshair and a floating card:
 * TradingView's interaction polish without any of its trading controls.
 */
export function LineChart({
  xs,
  series,
  xLabel,
  formatY,
  tooltip,
  onSelect,
  selectLabel = "See details",
  onHoverChange,
  height = 320,
  ariaLabel,
  animateKey,
  includeZero = false,
}: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pointerKind = useRef<string>("mouse");
  const gid = useId().replace(/:/g, "");

  const pad = { top: 18, right: width < 480 ? 46 : 58, bottom: 28, left: 6 };

  const layout = useMemo(() => {
    if (!width || xs.length === 0 || series.length === 0) return null;
    const innerW = Math.max(0, width - pad.left - pad.right);
    const innerH = height - pad.top - pad.bottom;

    const all = series.flatMap((s) => s.values);
    let min = Math.min(...all);
    let max = Math.max(...all);
    if (includeZero) {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
    if (min === max) {
      const gap = Math.max(Math.abs(max) * 0.05, 10_000);
      min -= gap;
      max += gap;
    } else {
      const gap = (max - min) * 0.12;
      max += gap;
      if (!(includeZero && min >= 0)) min -= gap;
    }

    const x = linearScale(xs[0], xs[xs.length - 1], pad.left, pad.left + innerW);
    const y = linearScale(min, max, pad.top + innerH, pad.top);
    const px = xs.map(x);
    const lines = series.map((s) => s.values.map((v, i) => ({ x: px[i], y: y(v) })));
    return { innerW, innerH, px, lines, ticks: niceTicks(min, max, 3), y, baseY: pad.top + innerH, min, max };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, xs, series, includeZero]);

  useEffect(() => {
    onHoverChange?.(hover);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover]);

  // Data can shrink under a held index (e.g. the range changed): ignore an index that no longer exists.
  const active = hover !== null && hover < xs.length ? hover : null;

  // On touch the card stays after the finger lifts; tapping elsewhere dismisses it.
  useEffect(() => {
    if (hover === null) return;
    const dismiss = (e: globalThis.PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setHover(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [hover, wrapRef]);

  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!layout) return;
    pointerKind.current = e.pointerType;
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(layout.px, e.clientX - rect.left));
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!layout) return;
    const last = xs.length - 1;
    const at = hover ?? last;
    if (e.key === "ArrowLeft") setHover(Math.max(0, at - 1));
    else if (e.key === "ArrowRight") setHover(Math.min(last, at + 1));
    else if (e.key === "Home") setHover(0);
    else if (e.key === "End") setHover(last);
    else if (e.key === "Escape") setHover(null);
    else if (e.key === "Enter" && hover !== null) onSelect?.(hover);
    else return;
    pointerKind.current = "keyboard";
    e.preventDefault();
  };

  const labelCount = width < 420 ? 3 : width < 700 ? 4 : 5;
  const touch = pointerKind.current === "touch";

  return (
    <div ref={wrapRef} className="relative select-none" style={{ height }}>
      {layout && (
        <>
          {/* Drawing, replayed when `animateKey` changes */}
          <div key={animateKey} className="chart-reveal absolute inset-0">
            <svg width={width} height={height} className="block overflow-visible" aria-hidden>
              <defs>
                {series
                  .filter((s) => s.area)
                  .map((s) => (
                    <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.26} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
              </defs>

              {layout.ticks.map((t) => {
                const y = layout.y(t);
                return (
                  <g key={t}>
                    <line x1={pad.left} x2={pad.left + layout.innerW} y1={y} y2={y} className={t === 0 ? "stroke-slate-300" : "stroke-slate-100"} strokeWidth={1} />
                    <text x={width - 2} y={y - 5} textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">
                      {formatY(t)}
                    </text>
                  </g>
                );
              })}

              {spreadIndexes(xs.length, labelCount).map((i, n, arr) => (
                <text
                  key={i}
                  x={layout.px[i]}
                  y={height - 6}
                  textAnchor={n === 0 ? "start" : n === arr.length - 1 ? "end" : "middle"}
                  className="fill-slate-400 text-[11px]"
                >
                  {xLabel(i)}
                </text>
              ))}

              {series.map((s, k) =>
                s.area && layout.lines[k].length > 1 ? (
                  <path key={`a-${s.key}`} d={areaPath(layout.lines[k], layout.baseY)} fill={`url(#${gid}-${s.key})`} />
                ) : null,
              )}
              {series.map((s, k) => (
                <path
                  key={`l-${s.key}`}
                  d={monotonePath(layout.lines[k])}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.strokeWidth ?? 2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={s.dashed ? "5 5" : undefined}
                />
              ))}

              {/* Where you are now */}
              {(() => {
                const last = layout.lines[0][layout.lines[0].length - 1];
                return last ? (
                  <g>
                    <circle cx={last.x} cy={last.y} r={5} fill={series[0].color} className="pulse-ring" />
                    <circle cx={last.x} cy={last.y} r={4.5} fill={series[0].color} stroke="#fff" strokeWidth={2} />
                  </g>
                ) : null;
              })()}
            </svg>
          </div>

          {/* Interaction layer: crosshair, dots, pointer + keyboard */}
          <svg
            width={width}
            height={height}
            className="absolute inset-0 cursor-crosshair overflow-visible outline-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-ring"
            style={{ touchAction: "pan-y" }}
            role="application"
            aria-label={`${ariaLabel}. Use left and right arrow keys to explore.`}
            tabIndex={0}
            onPointerDown={move}
            onPointerMove={move}
            onPointerLeave={(e) => e.pointerType !== "touch" && setHover(null)}
            onClick={() => active !== null && pointerKind.current !== "touch" && onSelect?.(active)}
            onKeyDown={onKey}
            onFocus={() => active === null && pointerKind.current === "keyboard" && setHover(xs.length - 1)}
            onBlur={() => pointerKind.current === "keyboard" && setHover(null)}
          >
            <rect x={0} y={0} width={width} height={height} fill="transparent" />
            {active !== null && (
              <g>
                <line
                  x1={layout.px[active]}
                  x2={layout.px[active]}
                  y1={pad.top - 4}
                  y2={layout.baseY}
                  className="stroke-slate-400"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
                {series.map((s, k) => (
                  <circle
                    key={s.key}
                    cx={layout.px[active]}
                    cy={layout.lines[k][active].y}
                    r={5.5}
                    fill={s.color}
                    stroke="#fff"
                    strokeWidth={2.5}
                  />
                ))}
              </g>
            )}
          </svg>

          {active !== null && (
            <div
              className="absolute top-2 z-10"
              style={{
                ...(layout.px[active] > width * 0.55 ? { right: width - layout.px[active] + 16 } : { left: layout.px[active] + 16 }),
                pointerEvents: touch && onSelect ? "auto" : "none",
              }}
            >
              <div className="fade-up" style={{ animationDuration: "160ms" }}>
                {tooltip(active, series)}
                {touch && onSelect && (
                  <button
                    type="button"
                    onClick={() => onSelect(active)}
                    className="mt-1.5 w-full rounded-xl palette-fixed bg-slate-900/95 px-3 py-2 text-left text-[12px] font-medium text-white shadow-xl"
                  >
                    {selectLabel} →
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
