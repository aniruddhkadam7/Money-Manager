"use client";

import { useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MarketKind } from "@/lib/market/types";
import { addToWatchlist, useWatchlist } from "@/lib/market/watchlist";
import { cn } from "@/lib/utils";
import { useSearch } from "./use-market";

const KIND_LABEL: Record<MarketKind, string> = {
  index: "Index",
  equity: "Share",
  etf: "ETF",
  fund: "Fund",
  commodity: "Commodity",
  currency: "Currency",
  crypto: "Crypto",
  yield: "Bond yield",
};

/**
 * Find a share, ETF, index, fund or coin by name or symbol. With `onPick` it's the page's search: tapping a result
 * opens it, and the + beside it follows it. Without, it's "Add to watchlist": tapping follows it.
 */
export function AddSymbolDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick?: (symbol: string) => void;
}) {
  const [q, setQ] = useState("");
  const { hits, searching, error } = useSearch(q);
  const watchlist = useWatchlist();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQ("");
      }}
    >
      <DialogContent className="sm:max-w-lg [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{onPick ? "Search" : "Add to watchlist"}</DialogTitle>
          <DialogDescription>Indian and foreign shares, ETFs, indices, mutual funds and crypto.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reliance, Tata Motors, Parag Parikh, AAPL…" className="pl-9" aria-label="Search" />
        </div>
        <div className="-mx-2 max-h-[55dvh] min-h-24 overflow-y-auto">
          {q.trim().length < 2 ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500">Type at least two letters.</p>
          ) : searching ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500">Searching…</p>
          ) : error ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500">Search isn&apos;t working right now. Try again in a minute.</p>
          ) : hits.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500">Nothing found for “{q.trim()}”.</p>
          ) : (
            <ul>
              {hits.map((h) => {
                const added = watchlist.includes(h.symbol);
                const star = (
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      added ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700",
                    )}
                    aria-label={added ? "Added" : "Add"}
                  >
                    {added ? <Check className="size-4" /> : <Plus className="size-4" />}
                  </span>
                );
                if (onPick)
                  return (
                    <li key={h.symbol} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onPick(h.symbol)}
                        className="flex min-w-0 flex-1 items-center rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-100 active:bg-slate-100"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">{h.name}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {KIND_LABEL[h.kind]}
                            {h.kind !== "fund" && ` · ${h.symbol}`}
                            {h.exchange && h.kind !== "fund" && ` · ${h.exchange}`}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={added}
                        onClick={() => addToWatchlist(h.symbol)}
                        className="rounded-full p-1.5"
                        title={added ? "In your watchlist" : "Add to watchlist"}
                      >
                        {star}
                      </button>
                    </li>
                  );
                return (
                  <li key={h.symbol}>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => addToWatchlist(h.symbol)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-100 disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{h.name}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {KIND_LABEL[h.kind]}
                          {h.kind !== "fund" && ` · ${h.symbol}`}
                          {h.exchange && h.kind !== "fund" && ` · ${h.exchange}`}
                        </span>
                      </span>
                      {star}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
