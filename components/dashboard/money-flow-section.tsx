"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { activityHref, monthFilter } from "@/lib/charts/links";
import { formatBps, formatExactINR, formatHeadlineINR } from "@/lib/charts/format";
import { formatDisplayDate, formatMonthLong } from "@/lib/domain/dates";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import { chronological } from "@/lib/finance/order";
import { moneyFlow, type MonthlyPoint } from "@/lib/finance/series";
import { CategoryIcon } from "../category-icon";
import { MoneyFlowChart, type FlowId } from "../charts/money-flow-chart";
import { ChartCard, EmptyChart } from "../charts/primitives";
import { useFinance } from "../finance-provider";

const pct = (part: number, whole: number) => (whole > 0 ? formatBps(Math.round((part / whole) * 10_000)) : "0%");

/** What happened to my income? Click any part for the detail behind it. */
export function MoneyFlowSection({ model }: { model: DashboardModel }) {
  const [back, setBack] = useState(0);
  const [selected, setSelected] = useState<FlowId | null>(null);
  const month = model.months[model.months.length - 1 - back];
  const flow = useMemo(() => moneyFlow(month), [month]);
  const hasFlow = flow.incomeMinor > 0 || flow.spentMinor > 0 || flow.investedMinor > 0;

  const caption =
    flow.incomeMinor <= 0
      ? flow.spentMinor > 0
        ? `No income in ${formatMonthLong(month.ym)} · spent ${formatExactINR(flow.spentMinor)}`
        : `Nothing recorded in ${formatMonthLong(month.ym)}.`
      : `${formatExactINR(flow.incomeMinor)} earned: ${pct(flow.spentMinor, flow.incomeMinor)} spent · ${pct(flow.investedMinor, flow.incomeMinor)} invested · ${pct(flow.savedMinor, flow.incomeMinor)} saved`;

  return (
    <ChartCard
      title="Where your income went"
      action={
        <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={back >= model.months.length - 1}
            onClick={() => { setBack(back + 1); setSelected(null); }}
            className="grid size-7 place-items-center rounded-full text-slate-500 transition hover:bg-card hover:text-slate-900 disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-28 text-center text-[13px] font-medium text-slate-700">{formatMonthLong(month.ym)}</span>
          <button
            type="button"
            aria-label="Next month"
            disabled={back === 0}
            onClick={() => { setBack(back - 1); setSelected(null); }}
            className="grid size-7 place-items-center rounded-full text-slate-500 transition hover:bg-card hover:text-slate-900 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      }
    >
      <p className="mb-4 max-w-2xl text-sm text-slate-500">{caption}</p>
      {!hasFlow ? (
        <EmptyChart height={240}>Record income and spending to see how your money flowed.</EmptyChart>
      ) : (
        <>
          <MoneyFlowChart flow={flow} selected={selected} onSelect={(id) => setSelected((s) => (s === id ? null : id))} animateKey={`${month.ym}-${flow.incomeMinor}-${flow.spentMinor}-${flow.investedMinor}`} />
          <FlowDetails key={`${month.ym}-${selected}`} id={selected} month={month} flow={flow} />
        </>
      )}
    </ChartCard>
  );
}

function FlowDetails({ id, month, flow }: { id: FlowId | null; month: MonthlyPoint; flow: ReturnType<typeof moneyFlow> }) {
  const { getCategory, book, describer } = useFinance();
  const { from, to } = monthFilter(month.ym);

  if (!id) {
    return null;
  }

  const Row = ({ href, left, right, icon }: { href?: string; left: string; right: string; icon?: React.ReactNode }) => {
    const body = (
      <>
        {icon}
        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{left}</span>
        <span className="text-sm font-semibold tabular-nums text-slate-900">{right}</span>
      </>
    );
    return href ? (
      <Link href={href} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-card">{body}</Link>
    ) : (
      <div className="flex items-center gap-3 px-2 py-2">{body}</div>
    );
  };

  let title = "";
  let content: React.ReactNode = null;
  let seeAll: string | undefined;

  if (id === "income") {
    title = `Income · ${formatExactINR(flow.incomeMinor)}`;
    seeAll = activityHref({ group: "income", from, to });
    content = month.incomeByCategory.map((c) => (
      <Row key={c.categoryId} left={getCategory(c.categoryId).name} right={formatExactINR(c.amountMinor)} icon={<CategoryIcon category={getCategory(c.categoryId)} />} />
    ));
  } else if (id === "spent") {
    title = `Spent · ${formatExactINR(flow.spentMinor)}`;
    seeAll = activityHref({ group: "spending", from, to });
    content = month.byCategory.slice(0, 5).map((c) => (
      <Row key={c.categoryId} href={activityHref({ category: c.categoryId, from, to })} left={getCategory(c.categoryId).name} right={formatExactINR(c.amountMinor)} icon={<CategoryIcon category={getCategory(c.categoryId)} />} />
    ));
  } else if (id === "invested") {
    title = `Invested · ${formatExactINR(flow.investedMinor)}`;
    seeAll = activityHref({ group: "investments", from, to });
    const oldestFirst = chronological(book.events);
    content = book.events
      .filter((e) => e.type === "invest" && e.date >= from && e.date <= to)
      .sort((a, b) => oldestFirst(b, a))
      .map((e) => (
        <Row key={e.id} left={`${describer.title(e)} · ${formatDisplayDate(e.date)}`} right={e.type === "invest" ? formatExactINR(e.amountMinor) : ""} />
      ));
  } else if (id === "saved") {
    title = `Saved · ${formatExactINR(flow.savedMinor)}`;
    content = (
      <p className="px-2 py-2 text-sm text-slate-600">
        Left after spending and investing: {pct(flow.savedMinor, flow.incomeMinor)} of income.
      </p>
    );
  } else {
    title = `From earlier savings · ${formatExactINR(flow.fromSavingsMinor)}`;
    content = (
      <p className="px-2 py-2 text-sm text-slate-600">
        Spent and invested {formatExactINR(flow.fromSavingsMinor)} more than you earned, from earlier savings.
      </p>
    );
  }

  return (
    <div className="fade-up mt-5 rounded-2xl bg-slate-50 p-3 sm:p-4">
      <div className="mb-1 flex items-center justify-between gap-3 px-2">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {seeAll && (
          <Link href={seeAll} className="text-[13px] font-medium text-emerald-700 hover:underline">
            See transactions
          </Link>
        )}
      </div>
      {content}
    </div>
  );
}
