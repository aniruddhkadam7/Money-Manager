"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPct } from "@/lib/market/format";
import type { IndexQuote } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { RangeTabs } from "../charts/primitives";
import { CompanySheet, type CompanyView } from "./company-sheet";
import { MarketHeader, MarketSource } from "./market-tabs";
import { SectorChart } from "./sector-chart";
import { SectorSheet } from "./sector-sheet";
import { tone } from "./tone";
import { useOverview } from "./use-market";

type Horizon = "today" | "year";
const HORIZONS: { value: Horizon; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "year", label: "1 year" },
];

/** How every Nifty sector is doing, best to worst, and how they've moved against each other. A sector opens to its companies. */
export function SectorsView() {
  const { data, status, stale, retry } = useOverview();
  const [sector, setSector] = useState<IndexQuote | null>(null);
  const [company, setCompany] = useState<CompanyView | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("today");

  const latest = data ? Math.max(...data.indices.map((i) => i.time)) : 0;
  const ret = (q: IndexQuote) => (horizon === "today" ? q.changePct : q.yearChangePct);
  const sectors = [...(data?.sectors ?? [])].sort((a, b) => (ret(b) ?? -Infinity) - (ret(a) ?? -Infinity));
  const max = Math.max(0.5, ...sectors.map((s) => Math.abs(ret(s) ?? 0)));

  return (
    <div className="grid grid-cols-1 gap-5">
      <MarketHeader stale={stale} />

      {status === "error" && !data ? (
        <section className="rounded-3xl border glass px-6 py-12 text-center">
          <p className="font-medium text-slate-900">Couldn&apos;t reach the market prices.</p>
          <Button className="mt-4" onClick={retry}>
            Try again
          </Button>
        </section>
      ) : (
        <>
          <section className="rounded-3xl border glass p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-slate-900">How India&apos;s sectors are doing</h2>
              <RangeTabs label="Over" value={horizon} options={HORIZONS} onChange={setHorizon} />
            </div>
            {!data ? (
              <div className="grid gap-2" aria-busy>
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : (
              <ul className="-mx-2 grid gap-0.5">
                {sectors.map((s) => {
                  const r = ret(s);
                  return (
                    <li key={s.symbol}>
                      <button
                        type="button"
                        onClick={() => setSector(s)}
                        className="grid w-full grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_4rem] items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-100/70 active:bg-slate-100 sm:grid-cols-[11rem_1fr_4.5rem]"
                      >
                        <span className="truncate text-sm font-medium text-slate-900">{s.name}</span>
                        <span className="relative h-5">
                          <span className="absolute inset-y-0 left-1/2 w-px bg-slate-200" />
                          {r !== null && (
                            <span className={cn("absolute inset-y-0.5 rounded-sm", r >= 0 ? "left-1/2 bg-emerald-500/80" : "right-1/2 bg-rose-500/80")} style={{ width: `${(Math.abs(r) / max) * 50}%` }} />
                          )}
                        </span>
                        <span className={cn("text-right text-sm font-semibold tabular-nums", tone(r))}>{formatPct(r, horizon === "today" ? 2 : 1)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-slate-500">Best to worst. Tap a sector for its companies.</p>
          </section>

          <SectorChart />
        </>
      )}
      <MarketSource delayMinutes={data?.delayMinutes} latest={latest} />

      <SectorSheet sector={sector} onClose={() => setSector(null)} onCompany={setCompany} />
      {/* Last, so a company opened from the sector sheet shows on top of it. */}
      <CompanySheet view={company} onClose={() => setCompany(null)} />
    </div>
  );
}
