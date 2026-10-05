"use client";

import { useState } from "react";
import Link from "next/link";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { daysBetween, formatDayMonth } from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import type { Frequency } from "@/lib/finance/recurring";
import { cn } from "@/lib/utils";
import { BrandLogo } from "../brand-logo";
import { CategoryIcon } from "../category-icon";
import { ChartCard, EmptyChart } from "../charts/primitives";
import { useFinance } from "../finance-provider";

const EVERY: Record<Frequency, string> = { weekly: "weekly", monthly: "monthly", yearly: "yearly" };

function due(days: number): string {
  if (days < -3) return "Overdue? Not seen recently";
  if (days < 0) return "Due, not recorded yet";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Next in ${days} days`;
}

/** Services you keep paying for, found automatically from your history (including imported statements). */
export function SubscriptionsSection({ model }: { model: DashboardModel }) {
  const { getCategory, today } = useFinance();
  const subs = model.subscriptions;
  const [all, setAll] = useState(false);
  const monthly = subs.reduce((t, c) => t + c.monthlyEquivalentMinor, 0);

  return (
    <ChartCard title="Subscriptions">
      {subs.length === 0 ? (
        <EmptyChart height={200}>
          Netflix, Spotify, phone plans, insurance and similar services appear here automatically once they&apos;ve been charged a couple of months in a row.
        </EmptyChart>
      ) : (
        <>
          <div className="mb-2" data-testid="subscriptions-total">
            <p className="text-3xl font-semibold tracking-tight tabular-nums text-slate-900">
              {formatExactINR(monthly)}
              <span className="ml-1.5 text-base font-normal text-slate-400">/ month</span>
            </p>
            <p className="mt-1 text-[13px] text-slate-500">
              {subs.length} {subs.length === 1 ? "subscription" : "subscriptions"} · about {formatExactINR(monthly * 12)} a year
            </p>
          </div>
          <ul className="grid" data-testid="subscriptions-list">
            {(all ? subs : subs.slice(0, 6)).map((c) => {
              const days = daysBetween(today, c.nextDate);
              return (
                <li key={c.key}>
                  <Link
                    href={activityHref({ q: c.name, category: c.categoryId })}
                    aria-label={`${c.name}: see every payment`}
                    className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <BrandLogo slug={c.brand} name={c.name} fallback={<CategoryIcon category={getCategory(c.categoryId)} tile className="!size-9 !rounded-lg" />} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-slate-900">{c.name}</p>
                      <p className={cn("text-xs", days < 0 ? "text-amber-600" : "text-slate-400")}>
                        {c.assumed ? "usually monthly" : c.via === "autopay" ? `auto-debit · ${EVERY[c.frequency]}` : c.via === "pattern" ? `repeats ${EVERY[c.frequency]}` : EVERY[c.frequency]} · {due(days)} · {formatDayMonth(c.nextDate)}
                      </p>
                    </div>
                    <p className="text-[15px] font-semibold tabular-nums text-slate-900">{formatExactINR(c.amountMinor)}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-slate-400">Missing one? Edit any of its payments and set the category to Subscriptions.</p>
          {subs.length > 6 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-xs font-medium text-emerald-700 hover:underline">
              {all ? "Show fewer" : `+${subs.length - 6} more`}
            </button>
          )}
        </>
      )}
    </ChartCard>
  );
}
