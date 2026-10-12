"use client";

import { useMemo } from "react";
import { ChartLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPrice, formatReturn } from "@/lib/market/format";
import { sparkFor } from "@/lib/market/perf";
import { PERIODS, type Period, type Quote } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { RangeTabs } from "../charts/primitives";
import { PRICE_SORTS, sortItems, SortSelect, useSort, type QuoteSort, type SortOption } from "./sort";
import { Sparkline } from "./sparkline";
import { useSector } from "./use-market";

const STOCK_SORTS: SortOption<QuoteSort>[] = [
  { value: "best", label: "Best return" },
  { value: "worst", label: "Worst return" },
  { value: "name", label: "Name A–Z" },
  ...PRICE_SORTS,
];

const returnTone = (v: number | null) => (v === null ? "text-slate-400" : v > 0 ? "text-emerald-700" : v < 0 ? "text-rose-700" : "text-slate-500");

/**
 * A sector opened up: the stocks in its Nifty index, best to worst over the chosen period, and how
 * many rose and fell. Tapping a stock opens its chart; the sector's own chart is a button away.
 */
export function SectorSheet({
  sector,
  period,
  onPeriod,
  onClose,
  onOpen,
}: {
  /** The sector's own quote (from the overview); null when closed. */
  sector: Quote | null;
  period: Period;
  onPeriod: (p: Period) => void;
  onClose: () => void;
  onOpen: (q: Quote) => void;
}) {
  return (
    <Dialog open={!!sector} onOpenChange={(open) => !open && onClose()}>
      {/* [&>*]:min-w-0: long company names truncate instead of widening the sheet past a phone screen. */}
      <DialogContent className="sm:max-w-2xl sm:max-h-[85dvh] sm:overflow-y-auto [&>*]:min-w-0">
        {sector && <Sheet key={sector.symbol} sector={sector} period={period} onPeriod={onPeriod} onOpen={onOpen} />}
      </DialogContent>
    </Dialog>
  );
}

function Sheet({ sector, period, onPeriod, onOpen }: { sector: Quote; period: Period; onPeriod: (p: Period) => void; onOpen: (q: Quote) => void }) {
  const { data, status, refresh } = useSector(sector.symbol);
  const [sort, setSort] = useSort("sector-stocks", STOCK_SORTS, "best");
  const words = PERIODS.find((p) => p.value === period)!.words;

  const stocks = useMemo(() => sortItems(data?.stocks ?? [], sort, period, (s) => s, (s) => s.name), [data, period, sort]);
  const up = stocks.filter((s) => (s.perf[period] ?? 0) > 0).length;
  const down = stocks.filter((s) => (s.perf[period] ?? 0) < 0).length;
  const own = sector.perf[period];
  // Bars share one scale, so a stock's bar reads against the others'.
  const max = Math.max(1, ...stocks.map((s) => Math.abs(s.perf[period] ?? 0)));

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>{sector.name}</DialogTitle>
        <DialogDescription>
          {stocks.length ? `${stocks.length} stocks in the Nifty index · ${up} up, ${down} down ${words}` : "The stocks in this Nifty index"}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">The sector {words}</p>
          <p className={cn("text-2xl font-semibold tabular-nums", returnTone(own))}>{formatReturn(own)}</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => onOpen(sector)}>
          <ChartLine /> Sector chart
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RangeTabs label="Returns over" value={period} options={PERIODS} onChange={onPeriod} />
        <SortSelect label="Sort stocks" value={sort} options={STOCK_SORTS} onChange={setSort} />
      </div>

      {status === "error" && !data ? (
        <div className="py-8 text-center">
          <p className="text-sm text-slate-500">Couldn&apos;t load this sector&apos;s stocks.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <div className="grid gap-2" aria-busy>
          <p className="text-xs text-slate-500">Fetching the sector&apos;s stocks…</p>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-11 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <>
          <ul className="-mx-2 divide-y divide-slate-100">
            {stocks.map((s) => {
              const r = s.perf[period];
              return (
                <li key={s.symbol}>
                  <button
                    type="button"
                    onClick={() => onOpen(s)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-100/70"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{s.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {s.symbol.replace(/\.NS$/, "")}
                        {s.industry && ` · ${s.industry}`}
                      </span>
                    </span>
                    <span className="max-[380px]:hidden">
                      <Sparkline values={sparkFor(s.spark, period)} width={56} height={24} />
                    </span>
                    <span className="w-28 shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums text-slate-900">{formatPrice(s.price, s)}</span>
                      <span className="flex items-center justify-end gap-1.5">
                        <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-slate-100">
                          {r !== null && (
                            <span
                              className={cn("absolute inset-y-0 left-0 rounded-full", r >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                              style={{ width: `${(Math.abs(r) / max) * 100}%` }}
                            />
                          )}
                        </span>
                        <span className={cn("text-xs font-medium tabular-nums", returnTone(r))}>{formatReturn(r)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {data.failed.length > 0 && <p className="text-xs text-slate-500">No prices right now for: {data.failed.join(", ")}.</p>}
          <p className="text-xs text-slate-500">Members from NSE&apos;s list for the index. The small line follows the period chosen.</p>
        </>
      )}
    </>
  );
}
