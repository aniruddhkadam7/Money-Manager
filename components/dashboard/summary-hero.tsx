"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { formatBps, formatExactINR, formatSignedINR } from "@/lib/charts/format";
import { activityHref, monthFilter } from "@/lib/charts/links";
import type { DashboardModel } from "@/lib/finance/dashboard-model";
import type { FinancialState } from "@/lib/finance/state";
import type { Book } from "@/lib/finance/types";
import { cardSpending } from "@/lib/finance/card-spend";
import { monthEnd, monthStart } from "@/lib/domain/dates";
import { cn } from "@/lib/utils";
import { DeltaPill } from "../charts/primitives";
import { ExplainSheet, HowIcon, useExplain } from "../explainer";
import { useFinance } from "../finance-provider";
import { NetWorthBreakdown, NetWorthBreakdownSheet } from "./net-worth-breakdown";
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
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold leading-none tracking-tight tabular-nums text-slate-900" title={title}>
        {value}
      </dd>
      <p
        className={cn(
          "mt-1 min-h-4 text-xs tabular-nums",
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
  return `${sign}₹${Math.round(Math.abs(minor) / 100).toLocaleString("en-IN")}`;
}

/** The 10-second answer: how much am I worth, and how is this month going. */
export function SummaryHero({ model, state, book }: { model: DashboardModel; state: FinancialState; book: Book }) {
  const { current } = model;
  // How much of this month's spending went on credit cards (part of "Spent", not extra).
  const cardSpent = cardSpending(book, monthStart(model.ym), monthEnd(model.ym)).spentMinor;
  const nw = state.netWorthMinor;
  const change = model.netWorthChangeMinor;
  const spendBps = model.spendingChangeBps;
  const invGain = state.investments.gainMinor;
  const invBase = state.investments.costBasisMinor;
  const invPct = invBase > 0 ? Math.round((invGain / invBase) * 10_000) : null;

  // "How it adds up" for each number, built from the same entries as the number.
  const { ledger, getCategory, today } = useFinance();
  const name = (id: string) => getCategory(id).name;
  const from = monthStart(model.ym);
  const to = monthEnd(model.ym);
  const lastMonthEnd = monthEnd(shiftMonth(model.ym, -1));
  const monthHref = (extra: Parameters<typeof activityHref>[0]) => activityHref({ ...monthFilter(model.ym), ...extra });
  const howAssets = useExplain();
  const howLiabilities = useExplain();
  const howChange = useExplain();
  const howSpent = useExplain();
  const howIncome = useExplain();
  const changeX = howChange.props.open ? explainNetWorthChange(book, ledger, lastMonthEnd, today, name) : null;
  const spentX = howSpent.props.open ? explainSpent(book, ledger, from, to, name) : null;
  const incomeX = howIncome.props.open ? explainIncome(book, ledger, from, to, name) : null;
  const catId = (label: string) => [...book.events].map((e) => ("categoryId" in e ? e.categoryId : "")).find((id) => id && name(id) === label);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-300/60 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.07),0_12px_32px_-16px_rgba(15,23,42,0.22)] sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -right-28 -top-32 size-96 rounded-full bg-emerald-400/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 size-80 rounded-full bg-indigo-400/[0.07] blur-3xl" />

      <div className="relative lg:flex lg:items-end lg:justify-between lg:gap-10">
        <div className="shrink-0">
        <p className="text-sm font-medium text-slate-500">Net worth</p>
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
            <button type="button" onClick={howChange.open} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Why it changed this month" data-testid="net-worth-change">
              <DeltaPill tone={change > 0 ? "positive" : change < 0 ? "negative" : "neutral"}>
                {change === 0 ? "No change" : formatSignedINR(change)} this month
              </DeltaPill>
            </button>
          )}
        </div>
        <div className="mt-3">
          <NetWorthBreakdown state={state} />
        </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 pt-4 sm:grid-cols-3 lg:mt-0 lg:max-w-4xl lg:flex-1 lg:grid-cols-5 lg:border-t-0 lg:pt-0">
          <Metric onHow={howAssets.open} href="/money#accounts" label="Total assets" value={formatHeadlineINR(state.assets.totalMinor)} title={formatExactINR(state.assets.totalMinor)} sub={`Bank & cash ${formatHeadlineINR(state.cashMinor)}${state.assets.creditBalancesMinor > 0 ? ` · Card paid ahead ${formatHeadlineINR(state.assets.creditBalancesMinor)}` : ""}`} />
          <Metric
            // Go where most of it is: people you owe, or cards and loans.
            href={state.liabilities.borrowedMinor >= state.liabilities.creditCardsMinor + state.liabilities.loansMinor ? "/money#owe" : "/money#cards-loans"}
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
            href={activityHref({ group: "spending", ...monthFilter(model.ym) })}
            label="Spent this month"
            onHow={howSpent.open}
            value={formatHeadlineINR(current.expensesMinor)}
            title={formatExactINR(current.expensesMinor)}
            sub={
              <>
                {spendBps !== null && <span className="block">{`${spendBps > 0 ? "▲" : spendBps < 0 ? "▼" : ""} ${formatBps(Math.abs(spendBps), 1)} vs last month`}</span>}
                {cardSpent !== 0 && <span className="block text-slate-500">{formatHeadlineINR(cardSpent)} on credit cards</span>}
              </>
            }
            subTone={spendBps === null ? undefined : spendBps > 0 ? "negative" : spendBps < 0 ? "positive" : "neutral"}
          />
          <Metric
            href={activityHref({ group: "income", ...monthFilter(model.ym) })}
            label="Income this month"
            onHow={howIncome.open}
            value={formatHeadlineINR(current.incomeMinor)}
            title={formatExactINR(current.incomeMinor)}
            sub={current.incomeMinor > 0 ? `Saved ${formatHeadlineINR(Math.max(current.savingsMinor, 0))}` : undefined}
          />
          <Metric
            href="/money#investments"
            label="Investments"
            value={formatHeadlineINR(state.investments.valueMinor)}
            title={formatExactINR(state.investments.valueMinor)}
            sub={invBase > 0 ? `${invGain >= 0 ? "+" : "−"}${formatHeadlineINR(Math.abs(invGain))}${invPct !== null ? ` (${invPct >= 0 ? "+" : "−"}${formatBps(Math.abs(invPct), 1)})` : ""}` : undefined}
            subTone={invBase > 0 ? (invGain >= 0 ? "positive" : "negative") : undefined}
          />
        </dl>
      </div>

      <NetWorthBreakdownSheet state={state} only="own" {...howAssets.props} />
      <NetWorthBreakdownSheet state={state} only="owe" {...howLiabilities.props} />
      {changeX && (
        <ExplainSheet
          {...howChange.props}
          signed
          title="Why your net worth changed this month"
          description={<>From the end of {formatDisplayDate(lastMonthEnd)} to today. Moving money between your own accounts, borrowing or lending, and paying bills don&apos;t change it: only income, spending, refunds, investment value and starting balances do.</>}
          sections={changeX.groups.map((g) => ({ title: g.label, rows: g.lines.map((l) => ({ ...l, href: catId(l.label) ? monthHref({ category: catId(l.label) }) : undefined })) }))}
          steps={[
            { label: `Net worth on ${formatDisplayDate(lastMonthEnd)}`, amountMinor: nw - changeX.totalMinor },
            ...changeX.groups.map((g) => ({ label: g.label, amountMinor: Math.abs(g.amountMinor), op: (g.amountMinor >= 0 ? "+" : "−") as "+" | "−" })),
            { label: "Net worth today", amountMinor: nw, op: "=" as const },
          ]}
        />
      )}
      {spentX && (
        <ExplainSheet
          {...howSpent.props}
          title="What you spent this month"
          description="Purchases by category, with refunds taken off. Card bill payments aren't counted: the card's purchases already are. Tap a line to see its entries."
          sections={[{ title: "By category", rows: spentX.lines.map((l) => ({ ...l, href: catId(l.label) ? monthHref({ category: catId(l.label) }) : undefined })), totalMinor: spentX.totalMinor, empty: "Nothing spent yet." }]}
          steps={[{ label: "Spent this month", amountMinor: spentX.totalMinor, op: "=" }]}
        />
      )}
      {incomeX && (
        <ExplainSheet
          {...howIncome.props}
          title="Your income this month"
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
