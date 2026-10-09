"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useWidth } from "./use-width";

export interface Bar {
  value: number;
  color: string;
  /** Drawn softer, e.g. the month still in progress. */
  soft?: boolean;
  /** Text above the bar. */
  valueLabel: string;
}

export interface Column extends Bar {
  key: string;
  label: string;
  /** Several bars side by side in this column (e.g. income and spending), instead of the single value. */
  bars?: Bar[];
}

interface Props {
  columns: Column[];
  tooltip: (index: number) => ReactNode;
  onSelect?: (index: number) => void;
  selectLabel?: string;
  height?: number;
  ariaLabel: string;
  animateKey: string;
}

/** A few friendly bars with a hover card. No axis: the labels say it all. */
export function ColumnChart({ columns, tooltip, onSelect, selectLabel = "See details", height = 280, ariaLabel, animateKey }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pointerKind = useRef("mouse");

  useEffect(() => {
    if (hover === null) return;
    const dismiss = (e: globalThis.PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setHover(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [hover, wrapRef]);

  const n = columns.length;
  const pad = { top: 30, bottom: 28, left: 4, right: 4 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const slot = n ? innerW / n : 0;
  const barsOf = (c: Column): Bar[] => c.bars ?? [c];
  const perCol = Math.max(1, ...columns.map((c) => barsOf(c).length));
  // A group of bars gets more of its slot than a single bar, with a small gap between the bars.
  const groupW = perCol > 1 ? Math.min(30 * perCol, slot * 0.72) : Math.min(64, slot * 0.56);
  const gap = perCol > 1 ? Math.min(4, groupW * 0.08) : 0;
  const barW = (groupW - gap * (perCol - 1)) / perCol;
  // Narrow side-by-side bars would have their amounts overlap: then the hover card carries them.
  const showValues = perCol === 1 || barW >= 24;
  const max = Math.max(...columns.flatMap((c) => barsOf(c).map((b) => b.value)), 1);
  const base = pad.top + innerH;
  const touch = pointerKind.current === "touch";
  const active = hover !== null && hover < n ? hover : null;

  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor((e.clientX - rect.left - pad.left) / slot)));
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const at = active ?? n - 1;
    if (e.key === "ArrowLeft") setHover(Math.max(0, at - 1));
    else if (e.key === "ArrowRight") setHover(Math.min(n - 1, at + 1));
    else if (e.key === "Escape") setHover(null);
    else if (e.key === "Enter" && active !== null) onSelect?.(active);
    else return;
    pointerKind.current = "keyboard";
    e.preventDefault();
  };

  const cx = (i: number) => pad.left + slot * i + slot / 2;

  return (
    <div ref={wrapRef} className="relative select-none" style={{ height }}>
      {width > 0 && n > 0 && (
        <>
          <div key={animateKey} className="absolute inset-0">
            <svg width={width} height={height} className="block overflow-visible" aria-hidden>
              {active !== null && (
                <rect x={cx(active) - slot / 2 + 3} y={pad.top - 22} width={slot - 6} height={innerH + 22 + 6} rx={14} className="fill-slate-100" />
              )}
              <line x1={pad.left} x2={width - pad.right} y1={base} y2={base} className="stroke-slate-200" strokeWidth={1} />
              {columns.map((c, i) => {
                const dim = active !== null && active !== i;
                const bars = barsOf(c);
                const left = cx(i) - (bars.length * barW + gap * (bars.length - 1)) / 2;
                return (
                  <g key={c.key} style={{ transition: "opacity 160ms" }} opacity={dim ? 0.45 : 1}>
                    {bars.map((b, j) => {
                      const h = Math.max((b.value / max) * innerH, b.value > 0 ? 4 : 2);
                      const x = left + j * (barW + gap);
                      return (
                        <g key={j}>
                          <rect
                            className="bar-grow"
                            x={x}
                            y={base - h}
                            width={barW}
                            height={h}
                            rx={Math.min(10, barW / 2)}
                            fill={b.color}
                            fillOpacity={b.soft ? 0.5 : 1}
                            style={{ animationDelay: `${i * 55 + j * 30}ms` }}
                          />
                          {showValues && (
                            <text x={x + barW / 2} y={base - h - 8} textAnchor="middle" className={`fill-slate-700 font-semibold tabular-nums ${bars.length > 1 ? "text-[10px]" : "text-[12px]"}`}>
                              {b.valueLabel}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    <text x={cx(i)} y={height - 7} textAnchor="middle" className={`text-[12px] ${active === i ? "fill-slate-900 font-semibold" : "fill-slate-400"}`}>
                      {c.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <svg
            width={width}
            height={height}
            className="absolute inset-0 cursor-pointer overflow-visible outline-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-ring"
            style={{ touchAction: "pan-y" }}
            role="application"
            aria-label={`${ariaLabel}. Use left and right arrow keys to explore.`}
            tabIndex={0}
            onPointerDown={(e) => {
              pointerKind.current = e.pointerType;
              setHover(indexAt(e));
            }}
            onPointerMove={(e) => {
              pointerKind.current = e.pointerType;
              setHover(indexAt(e));
            }}
            onPointerLeave={(e) => e.pointerType !== "touch" && setHover(null)}
            onClick={() => active !== null && pointerKind.current !== "touch" && onSelect?.(active)}
            onKeyDown={onKey}
            onFocus={() => active === null && pointerKind.current === "keyboard" && setHover(n - 1)}
            onBlur={() => pointerKind.current === "keyboard" && setHover(null)}
          >
            <rect x={0} y={0} width={width} height={height} fill="transparent" />
          </svg>

          {active !== null && (
            <div
              className="absolute z-10"
              style={{
                top: 4,
                ...(cx(active) > width * 0.55 ? { right: width - (cx(active) - slot / 2) + 6 } : { left: cx(active) + slot / 2 + 6 }),
                pointerEvents: touch && onSelect ? "auto" : "none",
              }}
            >
              <div className="fade-up" style={{ animationDuration: "160ms" }}>
                {tooltip(active)}
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
