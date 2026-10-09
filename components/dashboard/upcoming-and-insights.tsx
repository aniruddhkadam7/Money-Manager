"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { daysBetween, formatDayMonth } from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import { cn } from "@/lib/utils";
import { BrandLogo } from "../brand-logo";
import { CategoryIcon } from "../category-icon";
import { ChartCard, EmptyChart } from "../charts/primitives";
import { useFinance } from "../finance-provider";

function when(days: number): string {
  if (days < 0) return `${-days} ${-days === 1 ? "day" : "days"} ago, not recorded yet`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/**
 * What do I already owe, regularly, and what is coming up? Subscriptions have their own card and people you
 * owe are in "Who you owe", so the list here is the rest (rent, EMIs, bills).
 */
export function UpcomingSection({ model }: { model: DashboardModel }) {
  const { getCategory, today } = useFinance();
  const subscriptionKeys = new Set(model.subscriptions.map((c) => c.key));
  const upcoming = model.upcoming.filter((c) => !subscriptionKeys.has(c.key));

  return (
    <ChartCard title="Commitments & upcoming">
      {model.recurring.length === 0 ? (
        <EmptyChart height={200}>
          Payments that repeat 3 months in a row show up here.
        </EmptyChart>
      ) : (
        <>
          <div className="mb-2">
            <p className="text-3xl font-semibold tracking-tight tabular-nums text-slate-900">
              {formatExactINR(model.fixedCommitmentsMinor)}
              <span className="ml-1.5 text-base font-normal text-slate-400">/ month</span>
            </p>
            <p className="mt-1 text-[13px] text-slate-500">
              {model.recurring.length} repeating {model.recurring.length === 1 ? "payment" : "payments"} you can count on.
            </p>
          </div>

          {upcoming.length > 0 ? (
            <ul className="grid">
              {upcoming.slice(0, 5).map((c) => {
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
                          {when(days)} · {formatDayMonth(c.nextDate)}
                        </p>
                      </div>
                      <p className="text-[15px] font-semibold tabular-nums text-slate-900">{formatExactINR(c.amountMinor)}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : model.recurring.length > 0 ? (
            <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
              {model.upcoming.length > 0 ? "Only subscriptions are due in the next 30 days. They're listed in Subscriptions." : "Nothing is expected in the next 30 days."}
            </p>
          ) : null}
        </>
      )}
    </ChartCard>
  );
}

const DOT = { positive: "bg-emerald-500", negative: "bg-rose-500", neutral: "bg-slate-300" } as const;

/** Plain-language observations, each written from computed numbers. */
export function InsightsSection({ model }: { model: DashboardModel }) {
  return (
    <ChartCard title="Insights">
      {model.insights.length === 0 ? (
        <EmptyChart height={200}>Insights appear as you record more of your money activity.</EmptyChart>
      ) : (
        <ul className="grid gap-1">
          {model.insights.map((i, n) => {
            const body = (
              <>
                <span className={cn("mt-2 size-2 shrink-0 rounded-full", DOT[i.tone])} />
                <span className="flex-1 text-sm leading-relaxed text-slate-700">{i.text}</span>
                {i.href && <ArrowRight className="mt-1 size-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />}
              </>
            );
            return (
              <li key={i.id} className="fade-up" style={{ animationDelay: `${n * 60}ms` }}>
                {i.href ? (
                  <Link href={i.href} className="group flex items-start gap-3 rounded-xl px-2.5 py-2 hover:bg-slate-50">{body}</Link>
                ) : (
                  <div className="flex items-start gap-3 px-2.5 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}
