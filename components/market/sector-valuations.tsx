"use client";

import { SECTORS } from "@/lib/market/catalog";
import { formatPe } from "@/lib/market/format";
import type { Quote, ValuationResponse } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { ChartCard } from "../charts/primitives";
import { SortSelect, useSort, type SortOption } from "./sort";

type ValueSort = "listed" | "low" | "high" | "belowWorld" | "aboveWorld";
const SORTS: SortOption<ValueSort>[] = [
  { value: "listed", label: "Usual order" },
  { value: "low", label: "Lowest PE first" },
  { value: "high", label: "Highest PE first" },
  { value: "belowWorld", label: "Most below the world" },
  { value: "aboveWorld", label: "Most above the world" },
];

/**
 * What each Indian sector costs: NSE's published PE, the same worked out from the sector's stocks, and
 * the PE of the closest world sector. Nothing is filled in where a source has no figure.
 */
export function SectorValuations({
  data,
  status,
  quotes,
  onOpenSector,
  onOpenQuote,
}: {
  data: ValuationResponse | null;
  status: "loading" | "ready" | "error";
  quotes: Record<string, Quote>;
  onOpenSector: (q: Quote) => void;
  onOpenQuote: (q: Quote) => void;
}) {
  const [sort, setSort] = useSort("sector-valuations", SORTS, "listed");
  const rows = SECTORS.map((s) => {
    const v = data?.indices[s.symbol];
    const gap = v?.pe != null && v.global?.pe != null ? v.pe - v.global.pe : null;
    return { s, v, gap };
  });
  const key = (r: (typeof rows)[number]) =>
    sort === "low" ? (r.v?.pe == null ? null : -r.v.pe) : sort === "high" ? (r.v?.pe ?? null) : sort === "belowWorld" ? (r.gap === null ? null : -r.gap) : sort === "aboveWorld" ? r.gap : 0;
  const sorted = sort === "listed" ? rows : [...rows].sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity));
  const cols = "grid grid-cols-[minmax(0,1fr)_3rem_3.5rem_5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4rem_5rem_7.5rem] sm:gap-3";

  return (
    <ChartCard title="What sectors cost (PE)" action={<SortSelect label="Sort sectors by PE" value={sort} options={SORTS} onChange={setSort} />}>
      {status === "error" && !data ? (
        <p className="py-6 text-center text-sm text-slate-500">PEs aren&apos;t available right now. Try Refresh in a minute.</p>
      ) : !data ? (
        <div className="grid gap-2" aria-busy>
          {SECTORS.slice(0, 8).map((s) => (
            <span key={s.symbol} className="h-8 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ) : (
        <>
          <div className={cn(cols, "border-b border-slate-100 pb-1.5 text-[11px] font-medium text-slate-500")}>
            <span>Sector</span>
            <span className="text-right" title="NSE's published PE for the Nifty index">PE</span>
            <span className="text-right" title="Worked out from the index's stocks">From stocks</span>
            <span className="text-right">World</span>
          </div>
          <ul className="-mx-2 divide-y divide-slate-100">
            {sorted.map(({ s, v, gap }) => {
              const own = quotes[s.symbol];
              const world = v?.global ? quotes[v.global.symbol] : undefined;
              const stocks = v?.fromStocks;
              return (
                <li key={s.symbol} className={cn(cols, "px-2 py-2")}>
                  <button type="button" disabled={!own} onClick={() => own && onOpenSector(own)} className="min-w-0 truncate text-left text-sm font-medium text-slate-900 hover:underline disabled:no-underline">
                    {s.name}
                  </button>
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{formatPe(v?.pe)}</span>
                  <span
                    className="text-right text-sm tabular-nums text-slate-600"
                    title={stocks ? `${stocks.count} of ${stocks.total} stocks had figures${stocks.pe === null && stocks.count ? "; together they made a loss" : ""}` : undefined}
                  >
                    {stocks?.pe === null && stocks.count ? "Loss" : formatPe(stocks?.pe)}
                  </span>
                  <button
                    type="button"
                    disabled={!world}
                    onClick={() => world && onOpenQuote(world)}
                    className="min-w-0 text-right disabled:cursor-default"
                    title={v?.global?.name}
                  >
                    <span className="block text-sm tabular-nums text-slate-600">
                      {formatPe(v?.global?.pe)}
                      {gap !== null && (
                        <span className={cn("ml-1 text-[11px] font-medium", gap < 0 ? "text-emerald-700" : "text-rose-700")}>
                          {gap < 0 ? "↓" : "↑"}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">{v?.global?.name.replace(/^Global /, "") ?? "—"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            PE: price ÷ the last four quarters&apos; earnings. <b className="font-medium">PE</b> is NSE&apos;s own figure for the Nifty index
            {data.nseAsOf ? ` (as of ${data.nseAsOf})` : " (NSE couldn't be reached, so it's missing)"}.{" "}
            <b className="font-medium">From stocks</b> is the index&apos;s stocks&apos; total value ÷ their total earnings, from Yahoo; NSE counts only shares that trade freely, so the two differ a little.{" "}
            <b className="font-medium">World</b> is the PE of the iShares global fund for the closest MSCI sector (in dollars); several Indian sectors share one, and the match is the nearest, not exact. ↓ India&apos;s PE is below the world&apos;s, ↑ above.
          </p>
        </>
      )}
    </ChartCard>
  );
}
