"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Info, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildDashboardModel } from "@/lib/finance/dashboard-model";
import { useEventDialog } from "../events/event-dialog";
import { EventRow } from "../events/event-row";
import { useFinance } from "../finance-provider";
import { ChartCard } from "../charts/primitives";
import { BalanceSheetSection } from "./balance-sheet-section";
import { IncomeExpenseSection, SpendingSection } from "./cash-flow-sections";
import { CategorySection } from "./category-section";
import { HealthSection } from "./health-section";
import { InvestmentSection } from "./investment-section";
import { MoneyFlowSection } from "./money-flow-section";
import { NetWorthSection } from "./net-worth-section";
import { SoFarSection } from "./so-far-section";
import { SummaryHero } from "./summary-hero";
import { hasPartyData, TopParties } from "./top-parties";
import { SubscriptionsSection } from "./subscriptions-section";
import { InsightsSection, UpcomingSection } from "./upcoming-and-insights";

export function DashboardView() {
  const { status, book, ledger, state, today, getCategory } = useFinance();
  const { openAdd } = useEventDialog();

  // Every number on this page comes from this one deterministic model.
  const model = useMemo(
    () => buildDashboardModel(book, ledger, state, today, (id) => getCategory(id).name),
    [book, ledger, state, today, getCategory],
  );

  if (status === "loading") return <DashboardSkeleton />;
  if (status === "error")
    return <p className="py-20 text-center text-slate-500">Couldn&apos;t load your records from this browser.</p>;

  const hasAnything = book.events.length > 0 || book.accounts.some((a) => a.openingBalanceMinor !== 0);
  const negativeAssets = state.accounts.filter(
    (a) => a.account.type !== "credit_card" && a.account.type !== "loan" && a.balanceMinor < 0,
  );
  const recent = [...book.events]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  if (!hasAnything) {
    return (
      <section className="rounded-3xl border border-slate-200/70 bg-white px-6 py-16 text-center shadow-sm sm:py-24">
        <p className="text-sm font-medium text-slate-500">Welcome</p>
        <h1 className="mx-auto mt-2 max-w-md text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Tell the app what happens with your money.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-slate-500">
          Cash, UPI and cards are already set up. Enter what each holds today, then record things as they happen. Your net worth, spending and trends build themselves.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="default">
            <Link href="/money">Set your starting balances</Link>
          </Button>
          <Button variant="outline" onClick={() => openAdd()}>
            <Plus /> Record something
          </Button>
        </div>
      </section>
    );
  }

  const cell = "min-w-0 [&>section]:h-full";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {/* 1. Where do I stand? */}
      <div className="col-span-full">
        <SummaryHero model={model} state={state} />
      </div>

      {/* So far: earned, spent, and where */}
      <div className="col-span-full">
        <SoFarSection />
      </div>

      {/* Who pays me, who owes me, whom do I owe */}
      {hasPartyData(state, book.events.some((e) => e.type === "income")) && <TopParties state={state} />}

      {ledger.issues.length > 0 && (
        <Link
          href="/activity"
          className="col-span-full flex items-center gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <TriangleAlert className="size-4 shrink-0" />
          <span>
            <strong className="font-semibold">
              {ledger.issues.length} {ledger.issues.length === 1 ? "entry isn't" : "entries aren't"} counted.
            </strong>{" "}
            Tap to review.
          </span>
        </Link>
      )}

      {negativeAssets.length > 0 && (
        <Link href="/money#accounts" className="col-span-full flex items-center gap-2 rounded-2xl bg-sky-50 p-3 text-sm text-sky-900 hover:bg-sky-100">
          <Info className="size-4 shrink-0" />
          <span>
            <strong className="font-semibold">{negativeAssets.map((a) => a.account.name).join(", ")}</strong> is below zero because the
            app doesn&apos;t know your starting balance yet. Set it on the Money page for accurate totals.
          </span>
        </Link>
      )}

      {/* 2. Is my wealth growing? */}
      <div className={`${cell} lg:col-span-2`}>
        <NetWorthSection model={model} />
      </div>

      {/* 3. Income vs spending */}
      <div className={cell}>
        <IncomeExpenseSection model={model} />
      </div>
      <div className={cell}>
        <SpendingSection model={model} />
      </div>

      {/* 4-5. Where is it going, and is it growing? */}
      <div className={cell}>
        <CategorySection model={model} />
      </div>
      <div className={cell}>
        <InvestmentSection model={model} />
      </div>

      {/* 6. Balance sheet + health */}
      <div className={cell}>
        <BalanceSheetSection state={state} />
      </div>
      <div className={cell}>
        <HealthSection health={model.health} />
      </div>

      {/* 8. Commitments */}
      <div className={cell}>
        <UpcomingSection model={model} state={state} />
      </div>

      {/* Subscriptions */}
      <div className={cell}>
        <SubscriptionsSection model={model} />
      </div>

      {/* 7. What happened to my income? */}
      <div className={`${cell} xl:col-span-2`}>
        <MoneyFlowSection model={model} />
      </div>

      {/* 9. Insights */}
      <div className={`${cell} lg:col-span-2 xl:col-span-1`}>
        <InsightsSection model={model} />
      </div>

      {/* 10. Recent transactions */}
      <div className="col-span-full min-w-0">
        <ChartCard
          title="Recent activity"
          action={
            <Link href="/activity" className="text-sm font-medium text-emerald-700 hover:underline">
              View all
            </Link>
          }
          className="!px-0 sm:!px-0"
          headerClassName="px-4 sm:px-5"
        >
          <ul className="divide-y divide-slate-100 border-t border-slate-100 xl:grid xl:grid-cols-2 xl:divide-y-0">
            {recent.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
        </ChartCard>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid animate-pulse gap-4 lg:grid-cols-2 xl:grid-cols-3" aria-busy>
      <div className="col-span-full h-40 rounded-3xl bg-slate-100" />
      <div className="h-72 rounded-3xl bg-slate-100 lg:col-span-2" />
      <div className="h-72 rounded-3xl bg-slate-100" />
      <div className="h-64 rounded-3xl bg-slate-100" />
      <div className="h-64 rounded-3xl bg-slate-100" />
    </div>
  );
}
