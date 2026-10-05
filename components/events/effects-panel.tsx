"use client";

import { formatRupees } from "@/lib/finance/describe";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";

function signed(minor: number): string {
  if (minor === 0) return "No change";
  return `${minor > 0 ? "+" : "−"}${formatRupees(Math.abs(minor))}`;
}

/** "What changed" for one event: every balance it moved, and what it did to net worth. */
export function EffectsPanel({ eventId }: { eventId: string }) {
  const { ledger, describer, issuesByEvent } = useFinance();
  const entry = ledger.entries.find((e) => e.sourceId === eventId);
  const issue = issuesByEvent.get(eventId)?.[0];

  if (!entry) {
    return (
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">This entry isn&apos;t counted yet.</p>
        <p className="mt-0.5">{issue?.message ?? "It has no effect on your numbers."}</p>
      </div>
    );
  }

  const { effects, netWorthDeltaMinor } = describer.effects(entry);

  return (
    <div className="rounded-xl border">
      <p className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">What changed</p>
      <ul className="divide-y">
        {effects.map((fx, i) => (
          <li key={`${fx.label}-${i}`} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
            <span>{fx.label}</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                fx.deltaMinor === 0 && "text-muted-foreground",
              )}
            >
              {signed(fx.deltaMinor)}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-4 bg-muted/60 px-4 py-2.5 text-sm font-semibold">
          <span>Net worth</span>
          <span
            className={cn(
              "tabular-nums",
              netWorthDeltaMinor > 0 && "text-emerald-700",
              netWorthDeltaMinor < 0 && "text-red-700",
              netWorthDeltaMinor === 0 && "text-muted-foreground",
            )}
          >
            {signed(netWorthDeltaMinor)}
          </span>
        </li>
      </ul>
    </div>
  );
}
