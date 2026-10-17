"use client";

import { useState } from "react";
import { PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INDICES } from "@/lib/market/catalog";
import { formatChange, formatNumber, formatPct, formatTime } from "@/lib/market/format";
import type { IndexQuote } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { RangeTabs } from "../charts/primitives";
import { CompanySheet, type CompanyView } from "./company-sheet";
import { SectorChart } from "./sector-chart";
import { SectorSheet } from "./sector-sheet";
import { tone } from "./tone";
import { useOverview } from "./use-market";
import { WeightageSheet } from "./weightage-sheet";

type Horizon = "today" | "year";
const HORIZONS: { value: Horizon; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "year", label: "1 year" },
];

/**
 * India's market at a glance: the Nifty 50, Bank Nifty and Nifty 100, what each is made of (Weightage),
 * and how every sector is doing. A sector opens to its companies; a company to its ratios and how it
 * compares with the rest of its sector.
 */
export function MarketView() {
  const { data, status, stale, retry } = useOverview();
  const [weightage, setWeightage] = useState<string | null>(null);
  const [sector, setSector] = useState<IndexQuote | null>(null);
  const [company, setCompany] = useState<CompanyView | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("today");

  const latest = data ? Math.max(...data.indices.map((i) => i.time)) : 0;
  const ret = (q: IndexQuote) => (horizon === "today" ? q.changePct : q.yearChangePct);
  const sectors = [...(data?.sectors ?? [])].sort((a, b) => (ret(b) ?? -Infinity) - (ret(a) ?? -Infinity));
  const max = Math.max(0.5, ...sectors.map((s) => Math.abs(ret(s) ?? 0)));

  return (
    <div className="grid grid-cols-1 gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Market</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Yahoo Finance, {data?.delayMinutes ?? 15} minutes behind NSE{latest ? ` · prices to ${formatTime(latest)}` : ""}
          {stale && <span className="font-medium text-amber-700"> · couldn&apos;t refresh, showing older prices</span>}
        </p>
      </div>

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
            <ul className="grid gap-3 sm:grid-cols-3">
              {INDICES.map((item) => {
                const q = data?.indices.find((i) => i.symbol === item.symbol);
                return (
                  <li key={item.symbol}>
                    <button
                      type="button"
                      disabled={!q}
                      onClick={() => setWeightage(item.symbol)}
                      className="w-full rounded-2xl bg-slate-50 p-3 text-left transition-colors hover:bg-slate-100 active:bg-slate-100 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3"
                    >
                      <span className="block min-w-0">
                        <span className="block text-sm font-medium text-slate-600">{item.name}</span>
                        {q && (
                          <span className="block text-[11px] tabular-nums text-slate-500">
                            Day {formatNumber(q.dayLow)} – {formatNumber(q.dayHigh)}
                          </span>
                        )}
                      </span>
                      {q ? (
                        <span className="block shrink-0 sm:mt-2 max-sm:text-right">
                          <span className="block text-xl font-semibold tabular-nums text-slate-900">{formatNumber(q.price)}</span>
                          <span className={cn("text-sm font-semibold tabular-nums", tone(q.changePct))}>
                            {formatChange(q.change)} ({formatPct(q.changePct)})
                          </span>
                        </span>
                      ) : (
                        <span className="mt-2 block h-12 w-32 animate-pulse rounded-lg bg-slate-200/70" aria-busy />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button variant="outline" className="mt-3 w-full rounded-full" disabled={!data} onClick={() => setWeightage(INDICES[0].symbol)}>
              <PieChart /> Weightage: which sectors make up each index
            </Button>
          </section>

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
            <p className="mt-3 text-[11px] text-slate-500">Nifty sector indices, best to worst. Tap a sector for its companies.</p>
          </section>

          <SectorChart />
        </>
      )}

      <WeightageSheet open={!!weightage} start={weightage ?? INDICES[0].symbol} onClose={() => setWeightage(null)} onCompany={setCompany} />
      <SectorSheet sector={sector} onClose={() => setSector(null)} onCompany={setCompany} />
      {/* Last, so a company opened from either sheet shows on top of it. */}
      <CompanySheet view={company} onClose={() => setCompany(null)} />
    </div>
  );
}
