"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { formatDisplayDate, monthEnd, monthStart } from "@/lib/domain/dates";
import { accountActivity } from "@/lib/finance/account-activity";
import { bankBrandFor, bankLogoSrc } from "@/lib/finance/bank-logos";
import type { FinancialState } from "@/lib/finance/state";
import type { Account, Book } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE_INFO } from "../money/account-dialog";
import { PictureIcon } from "../picture-icon";
import { statementMatches, useStatementChecks, type StatementCheck } from "../statements/use-statement-checks";

/** The bank's official logo when the account or its statement names a known bank, else the account-type picture. */
function AccountLogo({ account, bankHint }: { account: Account; bankHint?: string }) {
  const brand = bankBrandFor(account.name, bankHint);
  const [broken, setBroken] = useState(false);
  if (!brand || broken) return <PictureIcon name={ACCOUNT_TYPE_INFO[account.type].picture} tile />;
  return (
    <span className="flex h-10 min-w-10 max-w-28 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white px-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={bankLogoSrc(brand)} alt={`${brand.name} logo`} className="max-h-7 max-w-full object-contain" loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "out" | "in" }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn("truncate text-sm font-semibold tabular-nums", tone === "out" && "text-slate-900", tone === "in" && "text-emerald-700")}>{formatExactINR(value)}</p>
    </div>
  );
}

/**
 * Every bank account and credit card you use, as its bank app would show it: the logo, what's available
 * (or, for a card, what's to pay), this month's spending, and whether the balance matches the bank's
 * latest statement.
 */
export function AccountsSection({ book, state, today }: { book: Book; state: FinancialState; today: string }) {
  const checks = useStatementChecks();
  const from = monthStart(today.slice(0, 7));
  const to = monthEnd(today.slice(0, 7));
  const used = (id: string) =>
    book.events.some((e) => ("accountId" in e && e.accountId === id) || ("fromAccountId" in e && e.fromAccountId === id) || ("toAccountId" in e && e.toAccountId === id));

  const order = { bank: 0, credit_card: 1, cash: 2 } as Record<string, number>;
  const rows = state.accounts
    .filter((a) => a.account.type in order && (a.balanceMinor !== 0 || used(a.account.id) || checks.has(a.account.id)))
    .sort((a, b) => order[a.account.type] - order[b.account.type]);
  if (rows.length === 0) return null;
  const month = new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { month: "long" });

  return (
    // Phones: one swipeable row (the next tile peeks in) so the accounts don't push the dashboard down.
    <section
      aria-label="Your accounts"
      className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-3 [&::-webkit-scrollbar]:hidden"
    >
      {rows.map(({ account, balanceMinor }) => {
        const card = account.type === "credit_card";
        const check = checks.get(account.id);
        const act = accountActivity(book, account.id, from, to);
        return (
          <div key={account.id} className="flex w-[85%] shrink-0 snap-start flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:w-auto" data-testid="account-tile">
            <Link href={activityHref({ account: account.id })} className="flex items-center gap-3 hover:underline">
              <AccountLogo account={account} bankHint={check?.bankHint} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-900">{account.name}</span>
                <span className="text-xs text-slate-500">
                  {ACCOUNT_TYPE_INFO[account.type].label}
                  {check?.accountMask && ` · ••${check.accountMask}`}
                </span>
              </span>
            </Link>

            {card ? <CardBalance balanceMinor={balanceMinor} /> : (
              <div>
                <p className="text-xs text-slate-500">Available balance</p>
                <p className={cn("text-2xl font-semibold tabular-nums", balanceMinor < 0 ? "text-red-700" : "text-slate-900")}>{formatExactINR(balanceMinor)}</p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
              <p className="col-span-3 -mb-1 text-[11px] text-slate-500">In {month}</p>
              <Stat label="Spent" value={act.spentMinor} tone="out" />
              {card ? <Stat label="Paid" value={act.paymentsInMinor} tone="in" /> : account.type === "bank" && <Stat label="Card bills" value={act.billsPaidMinor} tone="out" />}
              {!card && <Stat label="Received" value={act.receivedMinor} tone="in" />}
            </div>

            {check && !card && <StatementLine accountId={account.id} check={check} />}
          </div>
        );
      })}
    </section>
  );
}

function CardBalance({ balanceMinor }: { balanceMinor: number }) {
  if (balanceMinor > 0) {
    return (
      <div>
        <p className="text-xs text-slate-500">To pay</p>
        <p className="text-2xl font-semibold tabular-nums text-red-700">{formatExactINR(balanceMinor)}</p>
      </div>
    );
  }
  if (balanceMinor === 0) {
    return (
      <div>
        <p className="text-xs text-slate-500">To pay</p>
        <p className="text-2xl font-semibold tabular-nums text-slate-900">₹0</p>
      </div>
    );
  }
  // Payments with no purchases behind them: the card's statement was never added.
  return (
    <div>
      <p className="text-xs text-slate-500">To pay</p>
      <p className="text-2xl font-semibold tabular-nums text-slate-900">₹0</p>
      <Link href="/money#cards-loans" className="mt-1 flex gap-1.5 text-xs font-medium text-amber-700 hover:underline">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        Your bill payments are {formatExactINR(-balanceMinor)} more than the card purchases recorded. Add the purchases, or set what you owed before →
      </Link>
    </div>
  );
}

function StatementLine({ accountId, check }: { accountId: string; check: StatementCheck }) {
  const diff = check.appMinor - check.closingMinor;
  if (statementMatches(check)) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700">
        <CheckCircle2 className="size-3.5" /> Matches your bank statement of {formatDisplayDate(check.date)}
      </p>
    );
  }
  return (
    <Link href={activityHref({ account: accountId, to: check.date })} className="flex gap-1.5 text-xs font-medium text-amber-700 hover:underline">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      Bank statement on {formatDisplayDate(check.date)}: {formatExactINR(check.closingMinor)}. The app shows {formatExactINR(Math.abs(diff))} {diff > 0 ? "more" : "less"} →
    </Link>
  );
}
