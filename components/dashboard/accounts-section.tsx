"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { formatExactINR, formatHeadlineINR } from "@/lib/charts/format";
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
  if (!brand || broken) return <PictureIcon name={ACCOUNT_TYPE_INFO[account.type].picture} className="size-8" />;
  return (
    // A fixed box: most bank logos carry the bank's name, so they need width more than height.
    <span className="flex h-8 w-16 shrink-0 items-center justify-center rounded-md border border-slate-100 bg-white p-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={bankLogoSrc(brand)} alt={`${brand.name} logo`} className="h-full w-full object-contain" loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}

const short = (minor: number) => formatHeadlineINR(minor);

/**
 * Every bank account and credit card you use, compactly, as its bank app would show it: the logo, what's
 * available (or, for a card, what's to pay), this month's spending, and whether the balance matches the
 * bank's latest statement.
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
  const month = new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { month: "short" });

  return (
    // Phones: one swipeable row (the next tile peeks in) so the accounts don't push the dashboard down.
    <section
      aria-label="Your accounts"
      className="-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 xl:grid-cols-4 [&::-webkit-scrollbar]:hidden"
    >
      {rows.map(({ account, balanceMinor }) => {
        const card = account.type === "credit_card";
        const check = checks.get(account.id);
        const act = accountActivity(book, account.id, from, to);
        const parts = card
          ? [`Spent ${short(act.spentMinor)}`, `Paid ${short(act.paymentsInMinor)}`]
          : [`Spent ${short(act.spentMinor)}`, ...(account.type === "bank" ? [`Bills ${short(act.billsPaidMinor)}`] : []), `In ${short(act.receivedMinor)}`];
        return (
          <div key={account.id} className="flex w-[72%] shrink-0 snap-start flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:w-auto" data-testid="account-tile">
            <Link href={activityHref({ account: account.id })} className="flex items-center gap-2 hover:underline">
              <AccountLogo account={account} bankHint={check?.bankHint} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                {account.name}
                {check?.accountMask && <span className="font-normal text-slate-500"> ••{check.accountMask}</span>}
              </span>
            </Link>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500">{card ? "To pay" : "Available"}</span>
              <span className={cn("text-lg font-semibold tabular-nums", (card ? balanceMinor > 0 : balanceMinor < 0) ? "text-red-700" : "text-slate-900")}>
                {formatExactINR(card ? Math.max(balanceMinor, 0) : balanceMinor)}
              </span>
            </div>
            <p className="truncate text-[11px] tabular-nums text-slate-500" title={`In ${month}`}>
              {month}: {parts.join(" · ")}
            </p>
            {card && balanceMinor < 0 && (
              <Link href="/money#cards-loans" className="flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline" title="Your bill payments are more than the card purchases recorded. Add the purchases, or set what you owed before.">
                <TriangleAlert className="size-3 shrink-0" /> <span className="truncate">Paid {short(-balanceMinor)} more than purchases recorded</span>
              </Link>
            )}
            {check && !card && <StatementLine accountId={account.id} check={check} />}
          </div>
        );
      })}
    </section>
  );
}

function StatementLine({ accountId, check }: { accountId: string; check: StatementCheck }) {
  const diff = check.appMinor - check.closingMinor;
  if (statementMatches(check)) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-emerald-700">
        <CheckCircle2 className="size-3 shrink-0" /> <span className="truncate">Matches statement of {formatDisplayDate(check.date)}</span>
      </p>
    );
  }
  return (
    <Link
      href={activityHref({ account: accountId, to: check.date })}
      className="flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline"
      title={`Bank statement on ${formatDisplayDate(check.date)}: ${formatExactINR(check.closingMinor)}`}
    >
      <TriangleAlert className="size-3 shrink-0" />{" "}
      <span className="truncate">
        {formatExactINR(Math.abs(diff))} {diff > 0 ? "more" : "less"} than statement ({formatDisplayDate(check.date)})
      </span>
    </Link>
  );
}
