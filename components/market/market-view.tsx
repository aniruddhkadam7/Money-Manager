"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INDICES } from "@/lib/market/catalog";
import { formatChange, formatNumber, formatPct } from "@/lib/market/format";
import { cn } from "@/lib/utils";
import { CompanySheet, type CompanyView } from "./company-sheet";
import { MarketHeader, MarketSource } from "./market-tabs";
import { tone } from "./tone";
import { useOverview } from "./use-market";
import { WeightageSheet } from "./weightage-sheet";

/**
 * India's market at a glance: a table of its main indices, each NSE one opening to its sectors by weight and their
 * stocks. Sector performance is Market's other page (MarketTabs). A company opens to its ratios and how it compares with its sector.
 */
export function MarketView() {
  const { data, status, stale, retry } = useOverview();
  const [weightage, setWeightage] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyView | null>(null);

  const latest = data ? Math.max(...data.indices.map((i) => i.time)) : 0;

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
            <h2 className="mb-2 text-sm font-semibold tracking-tight text-slate-900">India&apos;s indices</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th scope="col" className="py-2 pr-2 font-medium">Index</th>
                  <th scope="col" className="py-2 px-2 text-right font-medium">Price</th>
                  <th scope="col" className="py-2 pl-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {/* Once prices are in, an index Yahoo had nothing for is left out rather than shown blank. */}
                {(data ? INDICES.filter((i) => data.indices.some((q) => q.symbol === i.symbol)) : INDICES).map((item) => {
                  const q = data?.indices.find((x) => x.symbol === item.symbol);
                  return (
                    // The whole row opens the index (the name's button is there for the keyboard and screen readers).
                    <tr key={item.symbol} onClick={item.list && q ? () => setWeightage(item.symbol) : undefined} className={cn(item.list && q && "cursor-pointer transition-colors hover:bg-slate-100/70 active:bg-slate-100")}>
                      <th scope="row" className="py-2.5 pr-2 text-left font-medium text-slate-900">
                        {item.list ? (
                          <button type="button" disabled={!q} title={`${item.name}: sectors and stocks`} className="inline-flex items-center gap-0.5 text-left">
                            {item.name}
                            <ChevronRight className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                          </button>
                        ) : (
                          item.name
                        )}
                        <span className="block text-[10px] font-semibold text-slate-400">{item.exchange ?? "NSE"}</span>
                      </th>
                      {q ? (
                        <>
                          <td className="py-2.5 px-2 text-right font-semibold tabular-nums text-slate-900">{formatNumber(q.price)}</td>
                          <td className={cn("py-2.5 pl-2 text-right tabular-nums", tone(q.changePct))}>
                            <span className="block font-semibold">{formatPct(q.changePct)}</span>
                            <span className="block text-[11px]">{formatChange(q.change)}</span>
                          </td>
                        </>
                      ) : (
                        <td colSpan={2} className="py-2.5 pl-2">
                          <span className="ml-auto block h-8 w-32 animate-pulse rounded-lg bg-slate-200/70" aria-busy />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-slate-500">Tap an index with › for its sectors by weight, then a sector for its stocks. NSE publishes no company lists for the BSE indices, and India VIX measures expected swings, not companies.</p>
          </section>

        </>
      )}
      <MarketSource delayMinutes={data?.delayMinutes} latest={latest} />

      <WeightageSheet symbol={weightage} quote={data?.indices.find((q) => q.symbol === weightage)} onClose={() => setWeightage(null)} onCompany={setCompany} />
      {/* Last, so a company opened from the index sheet shows on top of it. */}
      <CompanySheet view={company} onClose={() => setCompany(null)} />
    </div>
  );
}
