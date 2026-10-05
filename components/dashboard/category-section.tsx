"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { activityHref } from "@/lib/charts/links";
import { formatBps, formatExactINR, formatHeadlineINR } from "@/lib/charts/format";
import { monthEnd, monthStart, shiftMonth } from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import { CategoryIcon } from "../category-icon";
import { ChartCard, EmptyChart, Headline, RangeTabs } from "../charts/primitives";
import { useFinance } from "../finance-provider";

type Period = "this" | "last" | "3m";
const MAX_ROWS = 7;

function Bar({ ratio, opacity }: { ratio: number; opacity: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-indigo-500 transition-[width] duration-700 ease-out"
        style={{ width: shown ? `${Math.max(ratio * 100, 2)}%` : "0%", opacity }}
      />
    </div>
  );
}

/** Where is my money going? Click a category to see exactly what it is made of. */
export function CategorySection({ model }: { model: DashboardModel }) {
  const { report, getCategory } = useFinance();
  const [period, setPeriod] = useState<Period>("this");

  const range = useMemo(() => {
    const ym = model.ym;
    if (period === "this") return { from: monthStart(ym), to: monthEnd(ym), label: "this month" };
    if (period === "last") {
      const p = shiftMonth(ym, -1);
      return { from: monthStart(p), to: monthEnd(p), label: "last month" };
    }
    return { from: monthStart(shiftMonth(ym, -2)), to: monthEnd(ym), label: "the last 3 months" };
  }, [model.ym, period]);

  const data = useMemo(() => {
    const r = report(range.from, range.to);
    const all = r.expensesByCategory;
    const shown = all.slice(0, MAX_ROWS);
    const rest = all.slice(MAX_ROWS);
    return {
      total: r.expensesMinor,
      shown,
      restAmount: rest.reduce((t, c) => t + c.amountMinor, 0),
      restCount: rest.length,
      max: shown[0]?.amountMinor ?? 1,
    };
  }, [report, range]);

  const top = data.shown[0];

  return (
    <ChartCard
      title="Spending by category"
      action={
        <RangeTabs
          label="Category period"
          value={period}
          options={[{ value: "this", label: "This month" }, { value: "last", label: "Last month" }, { value: "3m", label: "3 months" }]}
          onChange={setPeriod}
        />
      }
    >
      <Headline
        value={formatHeadlineINR(data.total)}
        caption={
          top
            ? `${getCategory(top.categoryId).name} is your biggest expense ${range.label}: ${formatBps(Math.round((top.amountMinor / data.total) * 10_000))} of spending.`
            : `Nothing spent ${range.label}.`
        }
      />
      {data.shown.length === 0 ? (
        <EmptyChart height={200}>Spending will be broken down by category here.</EmptyChart>
      ) : (
        <ul key={period} className="-mx-2 grid">
          {data.shown.map((c, i) => {
            const category = getCategory(c.categoryId);
            return (
              <li key={c.categoryId} className="fade-up" style={{ animationDelay: `${i * 45}ms` }}>
                <Link
                  href={activityHref({ category: c.categoryId, from: range.from, to: range.to })}
                  className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-3.5 gap-y-1.5 rounded-xl px-2 py-1.5 outline-none transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${category.name}: ${formatExactINR(c.amountMinor)}. See transactions.`}
                >
                  <CategoryIcon category={category} tile className="row-span-2 !size-9 !rounded-lg" />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15px] font-medium text-slate-900">{category.name}</span>
                    <span className="shrink-0 text-[15px] font-semibold tabular-nums text-slate-900">{formatExactINR(c.amountMinor)}</span>
                  </div>
                  <span className="row-span-2 flex items-center gap-1 text-xs tabular-nums text-slate-400">
                    <span className="w-9 text-right">{formatBps(Math.round((c.amountMinor / data.total) * 10_000))}</span>
                    <ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                  <Bar ratio={c.amountMinor / data.max} opacity={Math.max(1 - i * 0.1, 0.4)} />
                </Link>
              </li>
            );
          })}
          {data.restCount > 0 && (
            <li>
              <Link
                href={activityHref({ group: "spending", from: range.from, to: range.to })}
                className="flex items-center justify-between rounded-xl px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
              >
                <span>
                  {data.restCount} other {data.restCount === 1 ? "category" : "categories"}
                </span>
                <span className="tabular-nums">{formatExactINR(data.restAmount)}</span>
              </Link>
            </li>
          )}
        </ul>
      )}
    </ChartCard>
  );
}
