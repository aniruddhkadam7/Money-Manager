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
  const spendShare = health.savingsRateBps === null ? null : 10_000 - health.savingsRateBps;
  return (
    <ChartCard title="Financial health">
      <div className="grid gap-3.5">
        <Meter label="Savings rate" hint="The share of this month's income you kept." display={pct(health.savingsRateBps)} bps={health.savingsRateBps} color="#059669" />
        <Meter label="Monthly spending" hint={spendShare === null ? "No income recorded this month yet." : `${formatBps(Math.max(spendShare, 0))} of this month's income.`} display={formatExactINR(health.monthlySpendingMinor)} bps={spendShare} color="#f43f5e" />
        <Meter label="Fixed commitments" hint={health.commitmentsShareBps === null ? "Repeating payments like rent and subscriptions, per month." : `${formatBps(health.commitmentsShareBps)} of income goes to repeating payments.`} display={formatExactINR(health.fixedCommitmentsMinor)} bps={health.commitmentsShareBps} color="#64748b" />
        <Meter label="Investment rate" hint="The share of this month's income you invested." display={pct(health.investmentRateBps)} bps={health.investmentRateBps} color="#6366f1" />
        <Meter label="Debt-to-asset ratio" hint="What you owe for every ₹100 you own. Lower is stronger." display={pct(health.debtToAssetBps)} bps={health.debtToAssetBps} color="#e11d48" />
      </div>
    </ChartCard>
  );
}
