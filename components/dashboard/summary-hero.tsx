"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { shield } from "@/lib/privacy";
import { formatBps, formatExactINR, formatSignedINR } from "@/lib/charts/format";
import { activityHref, monthFilter } from "@/lib/charts/links";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import type { FinancialState } from "@/lib/finance/state";
import type { Book } from "@/lib/finance/types";
import { monthEnd, monthStart } from "@/lib/domain/dates";
import { cn } from "@/lib/utils";
import { DeltaPill } from "../charts/primitives";
import { ExplainSheet, HowIcon, useExplain } from "../explainer";
import { useFinance } from "../finance-provider";
import { NetWorthBreakdown, NetWorthBreakdownSheet } from "./net-worth-breakdown";
import { NetWorthSparkline } from "./net-worth-sparkline";
import { useStatementGaps } from "../statements/use-statement-checks";
import { applyAnchorGaps, applyAnchorGapsToSeries } from "@/lib/finance/statement-anchor";
import { balanceSeries, changeBps } from "@/lib/finance/series";
import { deriveState } from "@/lib/finance/state";
import { formatMonthLong } from "@/lib/domain/dates";
import { useCardPeriod } from "./period";
import { explainIncome, explainNetWorthChange, explainSpent } from "@/lib/finance/explain";
import { formatDisplayDate, shiftMonth } from "@/lib/domain/dates";

function Metric({ label, value, sub, subTone, title, href, onHow }: { label: string; value: string; sub?: ReactNode; subTone?: "positive" | "negative" | "neutral"; title?: string; href: string; onHow?: () => void }) {
  return (
    <div className="relative min-w-0">
    {onHow && (
      <span className="absolute -top-1 right-0 z-10">
        <HowIcon onClick={onHow} label={label} />
      </span>
    )}
    <Link
      href={href}
      aria-label={`${label}: ${value}. See details.`}
      className="-m-2 block min-w-0 rounded-xl p-2 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <dt className="truncate pr-5 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold leading-none tracking-tight tabular-nums text-slate-900" title={title}>
        {value}
      </dd>
      <p
        className={cn(
          "mt-1 min-h-4 text-xs tabular-nums max-sm:truncate",
          subTone === "positive" && "text-emerald-600",
          subTone === "negative" && "text-rose-600",
          (!subTone || subTone === "neutral") && "text-slate-400",
        )}
      >
        {sub}
      </p>
    </Link>
    </div>
  );
}

/** Exact rupees, no "L" / "Cr" shortening: ₹3,60,245. Paise are shown in the tooltip. */
function formatHeadlineINR(minor: number): string {
  const sign = minor < 0 ? "−" : "";
  return shield(`${sign}₹${Math.round(Math.abs(minor) / 100).toLocaleString("en-IN")}`);
}

/** The 10-second answer: how much am I worth, and how is this month going. */
export function SummaryHero({ model, state: stateNow, book }: { model: DashboardModel; state: FinancialState; book: Book }) {
  // "How it adds up" for each number, built from the same entries as the number.
  const { ledger, getCategory, today, report } = useFinance();
  // The card's month switcher (above the chart) moves every figure here: an earlier month shows where you stood at
  // its end and what came in and went out during it. Other periods (1M, 3M…) change only the chart.
  const period = useCardPeriod("networth", model.firstActivity);
  const past = period.past;
  const ym = past ? period.from.slice(0, 7) : model.ym;
  const asOf = past ? period.to : today;
  const monthName = formatMonthLong(ym);
  // Bank balances as the statements say (as everywhere else), for that day too.
  const gaps = useStatementGaps();
  const state = useMemo(() => (past ? applyAnchorGaps(deriveState(book, ledger, asOf), gaps) : stateNow), [past, book, ledger, asOf, stateNow, gaps]);
  const month = useMemo(() => {
    if (!past) return { expensesMinor: model.current.expensesMinor, incomeMinor: model.current.incomeMinor, savingsMinor: model.current.savingsMinor, spendBps: model.spendingChangeBps };
    const r = report(monthStart(ym), monthEnd(ym));
    const before = report(monthStart(shiftMonth(ym, -1)), monthEnd(shiftMonth(ym, -1)));
    return { expensesMinor: r.expensesMinor, incomeMinor: r.incomeMinor, savingsMinor: r.savingsMinor, spendBps: changeBps(r.expensesMinor, before.expensesMinor) };
  }, [past, ym, report, model]);
  const current = month;
  const nw = state.netWorthMinor;
  const spendBps = month.spendBps;
  /** "this month" / "in October 2026". */
  const inMonth = past ? `in ${monthName}` : "this month";
  // The change this month on the same footing as the headline and the chart: bank balances as their latest
  // statements say. From entries alone it can differ (a statement shows money your entries don't).
  const lastMonthClose = monthEnd(shiftMonth(ym, -1));
  const change = useMemo(() => {
    if (model.netWorthChangeMinor === null) return null;
    const [before, now] = applyAnchorGapsToSeries(balanceSeries(book, ledger, [lastMonthClose, asOf]), gaps);
    return now.netWorthMinor - before.netWorthMinor;
  }, [model.netWorthChangeMinor, book, ledger, lastMonthClose, asOf, gaps]);
  const name = (id: string) => getCategory(id).name;
  const from = monthStart(ym);
  const to = monthEnd(ym);
  const lastMonthEnd = monthEnd(shiftMonth(ym, -1));
  const monthHref = (extra: Parameters<typeof activityHref>[0]) => activityHref({ ...monthFilter(ym), ...extra });
  const howAssets = useExplain();
  const howLiabilities = useExplain();
  const howChange = useExplain();
  const howSpent = useExplain();
  const howIncome = useExplain();
  const changeX = howChange.props.open ? explainNetWorthChange(book, ledger, lastMonthEnd, asOf, name) : null;
  const spentX = howSpent.props.open ? explainSpent(book, ledger, from, to, name) : null;
  const incomeX = howIncome.props.open ? explainIncome(book, ledger, from, to, name) : null;
  const catId = (label: string) => [...book.events].map((e) => ("categoryId" in e ? e.categoryId : "")).find((id) => id && name(id) === label);

  return (
    <section className="relative overflow-hidden rounded-3xl border glass p-4 sm:p-6">

      <div className="relative lg:flex lg:items-end lg:justify-between lg:gap-10">
        <div className="shrink-0">
        {/* The title, with the month switcher in the top-right corner (on "This month"), as on the other cards. */}
        <div className="flex min-h-9 items-center justify-between gap-3">
          <p className="text-sm font-medium text-slate-500">{past ? `Net worth on ${formatDisplayDate(asOf)}` : "Net worth"}</p>
          {period.stepper}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href="/money"
            aria-label={`Net worth ${formatExactINR(nw)}. See accounts.`}
            className={cn("rounded-lg text-4xl font-semibold leading-none tracking-tight tabular-nums outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring sm:text-5xl", nw < 0 ? "text-rose-600" : "text-slate-900")}
            title={formatExactINR(nw)}
          >
            {formatHeadlineINR(nw)}
          </Link>
          {change !== null && (
            <button type="button" onClick={howChange.open} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" title={`Why it changed ${inMonth}`} data-testid="net-worth-change">
              <DeltaPill tone={change > 0 ? "positive" : change < 0 ? "negative" : "neutral"}>
                {change === 0 ? "No change" : formatSignedINR(Math.round(change / 100) * 100).replace(/\.00$/, "")} {inMonth}
              </DeltaPill>
            </button>
          )}
        </div>
        <NetWorthSparkline firstActivity={model.firstActivity} period={period} />
        {/* Phones: the ⓘ on Total assets and Liabilities open the same breakdown, so the button is for wider screens. */}
        <div className="mt-3 max-sm:hidden">
          <NetWorthBreakdown state={state} />
        </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 pt-3 sm:mt-5 sm:grid-cols-4 sm:gap-y-4 sm:pt-4 lg:mt-0 lg:max-w-4xl lg:flex-1 lg:border-t-0 lg:pt-0">
          <Metric onHow={howAssets.open} href="/money#accounts" label="Total assets" value={formatHeadlineINR(state.assets.totalMinor)} title={formatExactINR(state.assets.totalMinor)} sub={<>Bank & cash {formatHeadlineINR(state.cashMinor)}{state.assets.creditBalancesMinor > 0 && <span className="max-sm:hidden"> · Paid ahead {formatHeadlineINR(state.assets.creditBalancesMinor)}</span>}</>} />
          <Metric
            // Go where most of it is: cards, or the Loans tab (bank loans and the people you owe).
            href={state.liabilities.creditCardsMinor > state.liabilities.loansMinor + state.liabilities.borrowedMinor ? "/money#cards-loans" : "/money#loans"}
            label="Liabilities"
            onHow={howLiabilities.open}
            value={formatHeadlineINR(state.liabilities.totalMinor)}
            title={formatExactINR(state.liabilities.totalMinor)}
            sub={
              state.liabilities.totalMinor === 0
                ? "Debt-free"
                : // Every non-zero part, negatives too (a card paid more than its recorded spending), so the parts add up to the total.
                  [
                    state.liabilities.borrowedMinor !== 0 && `People ${formatHeadlineINR(state.liabilities.borrowedMinor)}`,
                    state.liabilities.creditCardsMinor !== 0 && `Cards ${formatHeadlineINR(state.liabilities.creditCardsMinor)}`,
                    state.liabilities.loansMinor !== 0 && `Loans ${formatHeadlineINR(state.liabilities.loansMinor)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
            }
          />
          <Metric
            href={activityHref({ group: "spending", ...monthFilter(ym) })}
            label={past ? `Spent in ${monthName.slice(0, 3)}` : "Spent this month"}
            onHow={howSpent.open}
            value={formatHeadlineINR(current.expensesMinor)}
            title={formatExactINR(current.expensesMinor)}
            sub={
              <>
                {spendBps !== null && <span className="block">{`${spendBps > 0 ? "▲" : spendBps < 0 ? "▼" : ""} ${formatBps(Math.abs(spendBps), 1)} vs last month`}</span>}
              </>
            }
            subTone={spendBps === null ? undefined : spendBps > 0 ? "negative" : spendBps < 0 ? "positive" : "neutral"}
          />
          <Metric
            href={activityHref({ group: "income", ...monthFilter(ym) })}
            label={past ? `Income in ${monthName.slice(0, 3)}` : "Income this month"}
            onHow={howIncome.open}
            value={formatHeadlineINR(current.incomeMinor)}
            title={formatExactINR(current.incomeMinor)}
            sub={current.incomeMinor > 0 ? `Saved ${formatHeadlineINR(Math.max(current.savingsMinor, 0))}` : undefined}
          />
        </dl>
      </div>

      <NetWorthBreakdownSheet state={state} only="own" {...howAssets.props} />
      <NetWorthBreakdownSheet state={state} only="owe" {...howLiabilities.props} />
      {changeX && (
        <ExplainSheet
          {...howChange.props}
          signed
          title={`Why your net worth changed ${inMonth}`}
          description={<>From the end of {formatDisplayDate(lastMonthEnd)} to {past ? formatDisplayDate(asOf) : "today"}. Moving money between your own accounts, borrowing or lending, and paying bills don&apos;t change it: only income, spending, refunds, investment value and starting balances do.</>}
          sections={changeX.groups.map((g) => ({ title: g.label, rows: g.lines.map((l) => ({ ...l, href: catId(l.label) ? monthHref({ category: catId(l.label) }) : undefined })) }))}
          steps={[
            { label: `Net worth on ${formatDisplayDate(lastMonthEnd)}`, amountMinor: nw - (change ?? changeX.totalMinor) },
            ...changeX.groups.map((g) => ({ label: g.label, amountMinor: Math.abs(g.amountMinor), op: (g.amountMinor >= 0 ? "+" : "−") as "+" | "−" })),
            // What the bank statements show beyond your entries (bank balances follow the statements).
            ...(change !== null && change !== changeX.totalMinor
              ? [{ label: "Per your bank statements, beyond your entries", amountMinor: Math.abs(change - changeX.totalMinor), op: (change - changeX.totalMinor >= 0 ? "+" : "−") as "+" | "−" }]
              : []),
            { label: past ? `Net worth on ${formatDisplayDate(asOf)}` : "Net worth today", amountMinor: nw, op: "=" as const },
          ]}
        />
      )}
      {spentX && (
        <ExplainSheet
          {...howSpent.props}
          title={`What you spent ${inMonth}`}
          description="Purchases by category, with refunds taken off. Card bill payments aren't counted: the card's purchases already are. Tap a line to see its entries."
          sections={[{ title: "By category", rows: spentX.lines.map(({ entry, ...l }) => ({ ...l, href: entry ? activityHref({ category: entry.categoryId, from: entry.date, to: entry.date }) : catId(l.label) ? monthHref({ category: catId(l.label) }) : undefined })), totalMinor: spentX.totalMinor, empty: "Nothing spent yet." }]}
          steps={[{ label: past ? `Spent in ${monthName}` : "Spent this month", amountMinor: spentX.totalMinor, op: "=" }]}
        />
      )}
      {incomeX && (
        <ExplainSheet
          {...howIncome.props}
          title={`Your income ${inMonth}`}
          description="Money earned, by kind. Refunds and reimbursements aren't income: they reduce spending instead. Borrowed money isn't income either."
          sections={[{ title: "Income", rows: incomeX.lines.map((l) => ({ ...l, href: catId(l.label) ? monthHref({ category: catId(l.label) }) : undefined })), totalMinor: incomeX.totalMinor, empty: "No income yet this month." }]}
          steps={[
            { label: "Income", amountMinor: incomeX.totalMinor },
            { label: "Spent", amountMinor: incomeX.spentMinor, op: "−" },
            { label: "Saved", amountMinor: incomeX.savedMinor, op: "=" },
          ]}
        />
      )}
    </section>
  );
}
