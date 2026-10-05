"use client";

import { useEffect, useState } from "react";
import { formatCompactINR, formatExactINR, formatHeadlineINR } from "@/lib/charts/format";
import type { FinancialState } from "@/lib/finance/state";
import { cn } from "@/lib/utils";
import { ChartCard, EmptyChart } from "../charts/primitives";

interface Segment {
  id: string;
  label: string;
  value: number;
  color: string;
}

function BarRow({
  label,
  symbol,
  total,
  max,
  segments,
  active,
  onActive,
  big,
}: {
  label: string;
  symbol?: string;
  total: number;
  max: number;
  segments: Segment[];
  active: string | null;
  onActive: (id: string | null) => void;
  big?: boolean;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const parts = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-600">
          {symbol && <span className="grid size-5 place-items-center rounded-full bg-slate-100 text-xs text-slate-500">{symbol}</span>}
          {label}
        </p>
        <p className={cn("font-semibold tabular-nums text-slate-900", big ? "text-xl" : "text-lg")} title={formatExactINR(total)}>
          {formatHeadlineINR(total)}
        </p>
      </div>
      <div className={cn("flex overflow-hidden rounded-full bg-slate-100", big ? "h-4" : "h-3")}>
        <div className="flex h-full gap-0.5 transition-[width] duration-700 ease-out" style={{ width: shown && max > 0 ? `${(Math.abs(total) / max) * 100}%` : "0%" }}>
          {parts.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-label={`${s.label} ${formatExactINR(s.value)}`}
              onPointerEnter={() => onActive(s.id)}
              onPointerLeave={() => onActive(null)}
              onFocus={() => onActive(s.id)}
              onBlur={() => onActive(null)}
              className="h-full min-w-1 outline-none transition-opacity first:rounded-l-full last:rounded-r-full"
              style={{ flexGrow: s.value, backgroundColor: s.color, opacity: active && active !== s.id ? 0.35 : 1 }}
            />
          ))}
        </div>
      </div>
      {parts.length > 1 && (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {parts.map((s) => (
            <li
              key={s.id}
              className={cn("flex items-center gap-1.5 transition-opacity", active && active !== s.id && "opacity-40")}
              onPointerEnter={() => onActive(s.id)}
              onPointerLeave={() => onActive(null)}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label} <span className="tabular-nums text-slate-700">{formatHeadlineINR(s.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How healthy is my balance sheet? Assets − liabilities = net worth, drawn to scale. */
export function BalanceSheetSection({ state }: { state: FinancialState }) {
  const [active, setActive] = useState<string | null>(null);
  const assets = state.assets.totalMinor;
  const liabilities = state.liabilities.totalMinor;
  const nw = state.netWorthMinor;
  const max = Math.max(assets, liabilities, Math.abs(nw), 1);
  const empty = assets === 0 && liabilities === 0;
  const cover = liabilities > 0 ? assets / liabilities : null;

  return (
    <ChartCard title="Assets vs liabilities">
      <p className="mb-4 text-[13px] text-slate-500">
        {empty
          ? "Add your accounts to see what you own and what you owe."
          : cover === null
            ? "You don't owe anything: everything you own is yours."
            : cover >= 1
              ? `You own ${cover.toFixed(1)}× what you owe.`
              : `You owe more than you own: ${formatExactINR(liabilities - assets)} more.`}
      </p>
      {empty ? (
        <EmptyChart height={200}>Assets, liabilities and net worth will be compared here.</EmptyChart>
      ) : (
        <div className="grid gap-4">
          <BarRow
            label="Assets"
            total={assets}
            max={max}
            active={active}
            onActive={setActive}
            segments={[
              { id: "cash", label: "Cash & bank", value: state.assets.cashMinor, color: "#38bdf8" },
              { id: "investments", label: "Investments", value: state.assets.investmentsMinor, color: "#6366f1" },
              { id: "owed", label: "Owed to you", value: state.assets.receivablesMinor, color: "#a5b4fc" },
              { id: "credit", label: "Card / loan credit", value: state.assets.creditBalancesMinor, color: "#c7d2fe" },
            ]}
          />
          <BarRow
            label="Liabilities"
            symbol="−"
            total={liabilities}
            max={max}
            active={active}
            onActive={setActive}
            segments={[
              { id: "loans", label: "Loans", value: state.liabilities.loansMinor, color: "#e11d48" },
              { id: "cards", label: "Credit cards", value: state.liabilities.creditCardsMinor, color: "#fb7185" },
              { id: "borrowed", label: "Borrowed", value: state.liabilities.borrowedMinor, color: "#fda4af" },
            ]}
          />
          <div className="border-t border-slate-100 pt-4">
            <BarRow
              big
              label="Net worth"
              symbol="="
              total={nw}
              max={max}
              active={active}
              onActive={setActive}
              segments={[{ id: "nw", label: "Net worth", value: Math.abs(nw), color: nw >= 0 ? "#059669" : "#e11d48" }]}
            />
          </div>
        </div>
      )}
    </ChartCard>
  );
}
