"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Pencil } from "lucide-react";
import { formatCompactINR, formatExactINR } from "@/lib/charts/format";
import { addDays, daysBetween, formatDisplayDate } from "@/lib/domain/dates";
import { accountIdsUsedBy } from "@/lib/finance/book-ops";
import { ledgerIds } from "@/lib/finance/engine";
import { sampleDates } from "@/lib/finance/series";
import { gapAt } from "@/lib/finance/statement-anchor";
import { isAssetAccount } from "@/lib/finance/types";
import { isBrokerAccount } from "@/lib/brokers/broker-account";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";
import { AccountLogo, useBankHints } from "../account-logo";
import { LineChart } from "../charts/line-chart";
import { RangeTabs } from "../charts/primitives";
import { axisLabel } from "../dashboard/chart-helpers";
import { EventRow } from "../events/event-row";
import { useFinance } from "../finance-provider";
import { PageTitle } from "../page-title";
import { statementMatches, useBalances, useCardUsage, useStatementChecks, useStatementGaps } from "../statements/use-statement-checks";
import { Button } from "../ui/button";
import { AccountDialog, ACCOUNT_TYPE_INFO } from "./account-dialog";

type Span = "1M" | "3M" | "1Y" | "ALL";
const SPANS: { value: Span; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "All" },
];
const rs = (minor: number) => formatExactINR(minor);

/**
 * One account's own page: its balance and how sure it is (statement, Kotak; a card's due and limit), the balance over
 * time, and its latest entries. Opened by tapping an account.
 */
export function AccountView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { status, book, ledger, today } = useFinance();
  const { state } = useBalances();
  const gaps = useStatementGaps();
  const checks = useStatementChecks();
  const usageOf = useCardUsage();
  const bankHint = useBankHints();
  const [editing, setEditing] = useState(false);
  const [span, setSpan] = useSessionState<Span>(`account:${id}:span`, "3M");

  const account = book.accounts.find((a) => a.id === id);
  const asset = account ? isAssetAccount(account.type) : true;

  // Every move on this account, oldest first: its balance on any day, and the money in and out of any month.
  const moves = useMemo(() => {
    const lid = ledgerIds.account(id);
    const out: { date: string; amountMinor: number }[] = [];
    for (const e of ledger.entries) for (const p of e.postings) if (p.ledger === lid) out.push({ date: e.date, amountMinor: p.amountMinor });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [ledger, id]);

  const series = useMemo(() => {
    if (!account || moves.length === 0) return null;
    const first = moves[0].date;
    const from = span === "ALL" ? first : addDays(today, span === "1M" ? -30 : span === "3M" ? -91 : -365);
    const dates = sampleDates(from < first ? first : from, today, 90);
    let i = 0;
    let raw = 0;
    const values = dates.map((d) => {
      while (i < moves.length && moves[i].date <= d) raw += moves[i++].amountMinor;
      // As the app shows it: an asset's own balance (with its statement's word on it), a card or loan's amount owed.
      return asset ? raw + gapAt(gaps, id, d) : -raw;
    });
    return { dates, values };
  }, [account, moves, span, today, asset, gaps, id]);

  // All of the account's entries, newest first; the latest 12, or (See all) everything, 50 at a time, here.
  const allEntries = useMemo(
    () =>
      book.events
        .filter((e) => accountIdsUsedBy(e).includes(id))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))),
    [book.events, id],
  );
  const [shown, setShown] = useSessionState(`account:${id}:shown`, 12);
  const entries = allEntries.slice(0, shown);
  const seeAll = () => {
    setShown(Math.max(shown, 50));
    requestAnimationFrame(() => document.getElementById("account-entries")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (status === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;
  if (!account) {
    return (
      <div className="grid gap-4">
        <PageTitle>Account</PageTitle>
        <p className="rounded-2xl border p-4 text-sm text-muted-foreground">
          That account isn&apos;t here any more. <Link href="/money" className="font-medium text-foreground underline-offset-2 hover:underline">See your accounts</Link>
        </p>
      </div>
    );
  }

  const balance = state.accounts.find((a) => a.account.id === id)?.balanceMinor ?? 0;
  const card = account.type === "credit_card";
  const usage = card ? usageOf(account, balance) : null;
  const check = checks.get(id);
  const broker = isBrokerAccount(account);
  const kind = broker ? "Trading account · stocks" : ACCOUNT_TYPE_INFO[account.type].label;
  const span0 = series ? daysBetween(series.dates[0], series.dates[series.dates.length - 1]) : 0;

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4 sm:gap-5 [&>*]:min-w-0" data-testid="account-page">
      <PageTitle>{account.name}</PageTitle>

      {/* The account at a glance. */}
      <section className="rounded-3xl border glass p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <AccountLogo account={account} bankHint={bankHint(account.id)} tile />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">
              {account.name}
              {check?.accountMask && <span className="font-normal text-muted-foreground"> ••{check.accountMask}</span>}
            </h1>
            <p className="truncate text-sm text-muted-foreground">{kind}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label={`Edit ${account.name}`} onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">{card ? "To pay" : account.type === "loan" ? "Still owed" : broker ? "Available to trade" : "Balance"}</p>
        <p className={cn("text-3xl font-semibold tabular-nums", !card && account.type !== "loan" && balance < 0 && "text-rose-600")}>{rs(card ? Math.max(0, balance) : balance)}</p>
        {check && (
          <p className={cn("mt-1 flex items-center gap-1 text-xs", statementMatches(check) ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
            {statementMatches(check) && <CheckCircle2 className="size-3.5" />}
            {check.source === "kotak" ? "As per Kotak Neo sync" : statementMatches(check) ? "Matches the bank on" : "As per statement"} {formatDisplayDate(check.date)}
            {!statementMatches(check) && ` · ${rs(check.closingMinor - check.appMinor)} not in your entries`}
          </p>
        )}
        {usage && (
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <Fig label="Due" value={usage.dueMinor > 0 ? rs(usage.dueMinor) : "Nothing"} hint={usage.dueDate ? `by ${formatDisplayDate(usage.dueDate)}` : undefined} />
            <Fig label="Limit" value={rs(usage.limitMinor)} />
            <Fig label="Available" value={rs(usage.availableMinor)} />
          </dl>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={seeAll}>
            All entries
          </Button>
          {broker && (
            <Button asChild size="sm" variant="outline">
              <Link href="/investments">Open Invest</Link>
            </Button>
          )}
        </div>
      </section>

      {/* Balance over time. */}
      {series && series.dates.length > 1 && (
        <section className="rounded-3xl border glass p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{card || account.type === "loan" ? "Owed over time" : "Balance over time"}</h2>
            <RangeTabs label="Period" value={span} options={SPANS} onChange={setSpan} />
          </div>
          <LineChart
            xs={series.dates.map((d) => daysBetween(series.dates[0], d))}
            series={[{ key: "bal", label: "Balance", color: "#2563eb", values: series.values, area: true }]}
            height={180}
            ariaLabel={`${account.name} over time`}
            animateKey={`${id}-${span}`}
            formatY={formatCompactINR}
            xLabel={(i) => axisLabel(series.dates[i], span0)}
            tooltip={(i) => (
              <div className="rounded-xl border bg-card px-3 py-2 text-sm shadow-lg">
                <p className="text-xs text-muted-foreground">{formatDisplayDate(series.dates[i])}</p>
                <p className="font-semibold tabular-nums">{rs(series.values[i])}</p>
              </div>
            )}
          />
        </section>
      )}

      {/* Its latest entries. */}
      <section id="account-entries" className="scroll-mt-20 rounded-3xl border glass p-4 sm:p-5">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">
            {shown > 12 ? "Entries" : "Latest entries"}
            {shown > 12 && <span className="font-normal text-muted-foreground"> · {allEntries.length}</span>}
          </h2>
          {allEntries.length > 12 && (
            <button type="button" onClick={shown > 12 ? () => setShown(12) : seeAll} className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
              {shown > 12 ? "Show less" : "See all"}
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No entries yet.</p>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
        )}
        {shown > 12 && allEntries.length > shown && (
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setShown(shown + 50)}>
            Show more ({allEntries.length - shown} left)
          </Button>
        )}
      </section>

      {editing && <AccountDialog open onOpenChange={(o) => !o && setEditing(false)} editing={account} />}
    </div>
  );
}

function Fig({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "up" | "down" }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-2.5 py-2">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-sm font-semibold tabular-nums", tone === "up" && "text-emerald-600 dark:text-emerald-400", tone === "down" && "text-rose-600 dark:text-rose-400")}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
