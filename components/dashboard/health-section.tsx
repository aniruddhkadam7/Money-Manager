"use client";

import { useEffect, useState } from "react";
import { formatBps, formatExactINR } from "@/lib/charts/format";
import type { HealthMetrics } from "@/lib/finance/series";
import { ChartCard } from "../charts/primitives";

function Meter({ label, hint, display, bps, color }: { label: string; hint: string; display: string; bps: number | null; color: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const width = bps === null ? 0 : Math.min(Math.max(bps / 100, 0), 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-base font-semibold tabular-nums text-slate-900">{display}</p>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)}>
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: shown ? `${width}%` : "0%", backgroundColor: color }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}

const pct = (bps: number | null) => (bps === null ? "—" : `${bps < 0 ? "−" : ""}${formatBps(Math.abs(bps))}`);

/** A few honest ratios, no scores or grades. */
export function HealthSection({ health }: { health: HealthMetrics }) {
  return (
    <ChartCard title="Financial health">
      <div className="grid gap-3.5">
        <Meter label="Savings rate" hint="Of income, kept" display={pct(health.savingsRateBps)} bps={health.savingsRateBps} color="#059669" />
        {/* The rupee amounts (spent, commitments per month) are on their own cards; here only the shares of income. */}
        <Meter label="Fixed commitments" hint={`Repeating payments · ${formatExactINR(health.fixedCommitmentsMinor)}/month`} display={pct(health.commitmentsShareBps)} bps={health.commitmentsShareBps} color="#64748b" />
        <Meter label="Investment rate" hint="Of income, invested" display={pct(health.investmentRateBps)} bps={health.investmentRateBps} color="#6366f1" />
        <Meter label="Debt-to-asset ratio" hint="Owed per ₹100 owned · lower is better" display={pct(health.debtToAssetBps)} bps={health.debtToAssetBps} color="#e11d48" />
      </div>
    </ChartCard>
  );
}
