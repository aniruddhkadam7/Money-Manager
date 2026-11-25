"use client";

import { formatRupees } from "@/lib/finance/describe";
import type { PersonSummary } from "@/lib/finance/person-summary";
import type { Category } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "../category-icon";

/** Everything you've had with one person, in a few figures, and what the shared spending was on. */
export function TogetherSummary({
  summary: s,
  categories,
  categoryLimit = 5,
  className,
}: {
  summary: PersonSummary;
  categories: Category[];
  /** How many categories to list (largest first). */
  categoryLimit?: number;
  className?: string;
}) {
  const figures: { label: string; value: number; note?: string }[] = [
    { label: "You lent", value: s.lentMinor },
    { label: "They paid back", value: s.theyRepaidMinor },
    { label: "You borrowed", value: s.borrowedMinor },
    { label: "You paid back", value: s.youRepaidMinor },
    {
      label: s.splits.count === 1 ? "Their share of 1 split" : `Their share of ${s.splits.count} splits`,
      value: s.splits.theirShareMinor,
      note: `of ${formatRupees(s.splits.billsMinor)} in bills`,
    },
    { label: "You paid for them", value: s.paidForThemMinor },
    { label: "Paid to them", value: s.paidToThemMinor, note: "payments naming them" },
    { label: "Received from them", value: s.receivedFromThemMinor, note: "payments naming them" },
  ].filter((x) => x.value > 0);
  if (figures.length === 0) return null;
  const top = s.byCategory.slice(0, categoryLimit);
  return (
    <div className={cn("grid w-full basis-full gap-3 border-t pt-4", className)} data-testid="person-summary">
      <p className="text-xs font-medium text-muted-foreground">
        Everything with them · {s.entries} {s.entries === 1 ? "entry" : "entries"}
      </p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {figures.map((x) => (
          <div key={x.label} className="rounded-xl bg-muted/50 px-3 py-2">
            <dt className="truncate text-xs text-muted-foreground">{x.label}</dt>
            <dd className="font-semibold tabular-nums">{formatRupees(x.value)}</dd>
            {x.note && <dd className="truncate text-[11px] text-muted-foreground">{x.note}</dd>}
          </div>
        ))}
      </dl>
      {top.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">By category</p>
          <div className="flex flex-wrap gap-1.5">
            {top.map(({ categoryId, amountMinor }) => {
              const c = categories.find((x) => x.id === categoryId);
              return (
                <span key={categoryId} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
                  {c && <CategoryIcon category={c} className="size-4" />}
                  {c?.name ?? "Other"}
                  <span className="font-medium tabular-nums">{formatRupees(amountMinor)}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
