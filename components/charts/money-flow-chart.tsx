"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { formatHeadlineINR } from "@/lib/charts/format";
import type { MoneyFlow } from "@/lib/finance/series";

export type FlowId = "income" | "fromSavings" | "spent" | "invested" | "saved";

const COLORS: Record<FlowId, string> = {
  income: "#059669",
  fromSavings: "#94a3b8",
  spent: "#f43f5e",
  invested: "#6366f1",
  saved: "#34d399",
};

const LABELS: Record<FlowId, string> = {
  income: "Income",
  fromSavings: "From savings",
  spent: "Spent",
  invested: "Invested",
  saved: "Saved",
};

interface Props {
  flow: MoneyFlow;
  selected: FlowId | null;
  onSelect: (id: FlowId) => void;
  animateKey: string;
}

const SIZE = 220;
const STROKE = 28;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/** Where did this month's income go? A donut split into spent, invested and saved, with a legend. */
export function MoneyFlowChart({ flow, selected, onSelect, animateKey }: Props) {
  const [hover, setHover] = useState<FlowId | null>(null);

  const parts = useMemo(
    () =>
      ([
        { id: "spent" as const, amount: flow.spentMinor },
        { id: "invested" as const, amount: flow.investedMinor },
        { id: "saved" as const, amount: flow.savedMinor },
      ]).filter((p) => p.amount > 0),
    [flow],
  );
  const total = parts.reduce((t, p) => t + p.amount, 0);
  const base = flow.incomeMinor > 0 ? flow.incomeMinor : total;
  const active = hover ?? selected;

  const gap = parts.length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = parts.map((p) => {
    const len = (p.amount / total) * C;
    const arc = { ...p, dash: Math.max(len - gap, 1), offset };
    offset += len;
    return arc;
  });

  const keyActivate = (id: FlowId) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };

  const share = (amount: number) => `${Math.round((amount / base) * 100)}%`;

  const legend: { id: FlowId; amount: number; note?: string }[] = [
    ...(flow.incomeMinor > 0 ? [{ id: "income" as const, amount: flow.incomeMinor }] : []),
    ...parts.map((p) => ({ id: p.id, amount: p.amount, note: flow.incomeMinor > 0 ? `${share(p.amount)} of income` : undefined })),
    ...(flow.fromSavingsMinor > 0 ? [{ id: "fromSavings" as const, amount: flow.fromSavingsMinor, note: "Covered by earlier savings" }] : []),
  ];

  return (
    <div key={animateKey} className="chart-reveal flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-12">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} role="group" aria-label="Where this month's income went" className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#f1f5f9" strokeWidth={STROKE} />
          {arcs.map((a) => (
            <circle
              key={a.id}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={COLORS[a.id]}
              strokeWidth={active === a.id ? STROKE + 6 : STROKE}
              strokeDasharray={`${a.dash} ${C - a.dash}`}
              strokeDashoffset={-a.offset}
              opacity={active !== null && active !== a.id && active !== "income" ? 0.35 : 1}
              style={{ transition: "opacity 180ms, stroke-width 180ms", cursor: "pointer" }}
              onPointerEnter={() => setHover(a.id)}
              onPointerLeave={() => setHover(null)}
              onClick={() => onSelect(a.id)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-xs text-slate-500">{flow.incomeMinor > 0 ? "Income" : "Spent"}</p>
            <p className="text-xl font-semibold tabular-nums text-slate-900">{formatHeadlineINR(base)}</p>
          </div>
        </div>
      </div>

      <ul className="w-full max-w-sm divide-y divide-slate-100">
        {legend.map((row) => (
          <li key={row.id}>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={selected === row.id}
              aria-label={`${LABELS[row.id]} ${formatHeadlineINR(row.amount)}. Show details.`}
              onPointerEnter={() => setHover(row.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(row.id)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect(row.id)}
              onKeyDown={keyActivate(row.id)}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 outline-none transition hover:bg-slate-50 focus-visible:bg-slate-50 ${selected === row.id ? "bg-slate-50" : ""}`}
            >
              <span className="size-3 shrink-0 rounded-full" style={{ background: COLORS[row.id] }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-800">{LABELS[row.id]}</span>
                {row.note && <span className="block text-xs text-slate-400">{row.note}</span>}
              </span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{formatHeadlineINR(row.amount)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
