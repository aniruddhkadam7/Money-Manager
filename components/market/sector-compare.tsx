"use client";

import { useState } from "react";
import { CATALOG, SECTOR_PAIRS } from "@/lib/market/catalog";
import { formatReturn } from "@/lib/market/format";
import { inRupees } from "@/lib/market/perf";
import { PERIODS, type Period, type Quote } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { ChartCard, RangeTabs } from "../charts/primitives";
import { SortSelect, useSort, type SortOption } from "./sort";

/** One colour per side, so the pair reads apart whichever way each moved. */
const INDIA_COLOR = "#f97316";
const WORLD_COLOR = "#6366f1";

type CompareSort = "listed" | "india" | "world" | "indiaAhead" | "worldAhead";
const SORTS: SortOption<CompareSort>[] = [
  { value: "listed", label: "Usual order" },
  { value: "india", label: "India's best first" },
  { value: "world", label: "World's best first" },
  { value: "indiaAhead", label: "India furthest ahead" },
  { value: "worldAhead", label: "World furthest ahead" },
];

type Currency = "inr" | "usd";
const CURRENCIES: { value: Currency; label: string }[] = [
  { value: "inr", label: "₹" },
  { value: "usd", label: "$" },
];

const tone = (v: number | null) => (v === null ? "text-slate-400" : v > 0 ? "text-emerald-700" : v < 0 ? "text-rose-700" : "text-slate-500");

/**
 * Each sector in India beside the same sector worldwide, over the page's period. The world side is in
 * dollars; in rupees it also carries the dollar's move against the rupee, which is what an Indian
 * investor in a global fund actually gets.
 */
export function SectorCompare({
  quotes,
  period,
  onOpenSector,
  onOpenQuote,
}: {
  quotes: Record<string, Quote>;
  period: Period;
  onOpenSector: (q: Quote) => void;
  onOpenQuote: (q: Quote) => void;
}) {
  const [currency, setCurrency] = useState<Currency>("inr");
  const [sort, setSort] = useSort("sector-compare", SORTS, "listed");
  const words = PERIODS.find((p) => p.value === period)!.words;
  const fx = quotes["USDINR=X"]?.perf[period] ?? null;

  const rows = SECTOR_PAIRS.map((pair) => {
    const india = pair.india ? quotes[pair.india] : undefined;
    const world = quotes[pair.world];
    const usd = world?.perf[period] ?? null;
    const w = currency === "usd" ? usd : inRupees(usd, fx);
    const i = india?.perf[period] ?? null;
    return { pair, india, world, i, w, gap: i !== null && w !== null ? i - w : null };
  });
  const key = (r: (typeof rows)[number]) => (sort === "india" ? r.i : sort === "world" ? r.w : sort === "indiaAhead" ? r.gap : sort === "worldAhead" ? (r.gap === null ? null : -r.gap) : 0);
  const sorted = sort === "listed" ? rows : [...rows].sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity));
  const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.i ?? 0), Math.abs(r.w ?? 0)]));
  const compared = rows.filter((r) => r.gap !== null);
  const ahead = compared.filter((r) => r.gap! > 0).length;
  const loading = !rows.some((r) => r.world);

  const bar = (v: number | null, color: string) => (
    <span className="relative h-2.5">
      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-slate-200" />
      {v !== null && (
        <span
          className={cn("absolute inset-y-0 rounded-sm", v >= 0 ? "left-1/2" : "right-1/2")}
          style={{ width: `${(Math.abs(v) / max) * 50}%`, backgroundColor: color }}
        />
      )}
    </span>
  );

  return (
    <ChartCard
      title="India vs the world, by sector"
      action={
        <div className="flex items-center gap-2">
          <RangeTabs label="World returns in" value={currency} options={CURRENCIES} onChange={setCurrency} />
          <SortSelect label="Sort sectors" value={sort} options={SORTS} onChange={setSort} />
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <p className="text-slate-600">
          {loading ? "Loading…" : `India did better in ${ahead} of ${compared.length} sectors ${words}`}
        </p>
        <span className="flex items-center gap-3 text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: INDIA_COLOR }} /> India
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: WORLD_COLOR }} /> World {currency === "inr" ? "(in ₹)" : "(in $)"}
          </span>
        </span>
      </div>

      {loading ? (
        <div className="grid gap-3" aria-busy>
          {SECTOR_PAIRS.slice(0, 6).map((p) => (
            <span key={p.world} className="h-10 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-slate-100">
          {sorted.map(({ pair, india, world, i, w, gap }) => (
            <li key={pair.world} className="px-2 py-2">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{pair.label}</span>
                {gap !== null && (
                  <span className="text-[11px] text-slate-500">
                    {Math.abs(gap) < 0.05 ? "Level" : `${gap > 0 ? "India" : "World"} ahead by ${Math.abs(gap).toFixed(1)} pts`}
                  </span>
                )}
              </div>
              <div className="grid gap-0.5">
                {[
                  { who: "India", sub: india ? india.name : "No Nifty index", q: india, v: i, color: INDIA_COLOR, open: onOpenSector },
                  { who: "World", sub: CATALOG[pair.world]?.name ?? pair.world, q: world, v: w, color: WORLD_COLOR, open: onOpenQuote },
                ].map((side) => (
                  <button
                    key={side.who}
                    type="button"
                    disabled={!side.q}
                    onClick={() => side.q && side.open(side.q)}
                    className="grid grid-cols-[6.5rem_1fr_3.75rem] items-center gap-3 rounded-lg py-0.5 text-left transition-colors hover:bg-slate-100/70 disabled:hover:bg-transparent sm:grid-cols-[9rem_1fr_4.5rem]"
                  >
                    <span className="truncate text-xs text-slate-500" title={side.sub}>
                      {side.who} · {side.q ? side.sub.replace(/^Global /, "") : side.sub}
                    </span>
                    {bar(side.v, side.color)}
                    <span className={cn("text-right text-xs font-semibold tabular-nums", tone(side.v))}>{side.q ? formatReturn(side.v) : "—"}</span>
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        World: iShares global sector ETFs (MSCI all-country sectors, priced in dollars).
        {currency === "inr" ? " In ₹ they include the dollar's move against the rupee: what an Indian investor in a global fund gets." : " In $: the sectors' own performance, without the currency."}{" "}
        Tap India for its stocks, World for its chart.
      </p>
    </ChartCard>
  );
}
