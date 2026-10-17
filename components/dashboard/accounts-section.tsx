"use client";

import Link from "next/link";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { formatDisplayDate } from "@/lib/domain/dates";
import { explainAccountBalance } from "@/lib/finance/explain";
import type { FinancialState } from "@/lib/finance/state";
import type { Account, Book } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { ExplainSheet, HowIcon, useExplain } from "../explainer";
import { useFinance } from "../finance-provider";
import { AccountLogo, useBankHints } from "../account-logo";
import { useStatementChecks } from "../statements/use-statement-checks";

/**
 * Every bank account and credit card you use, compactly, as its bank app would show it: the logo and what's
 * available (or, for a card, what's to pay). This month's spending is in the summary at the top.
 */
export function AccountsSection({ book, state }: { book: Book; state: FinancialState }) {
  const checks = useStatementChecks();
  // The bank any of the account's statements names (card statements print no closing balance, so not only `checks`).
  const bankOf = useBankHints();
  const used = (id: string) =>
    book.events.some((e) => ("accountId" in e && e.accountId === id) || ("fromAccountId" in e && e.fromAccountId === id) || ("toAccountId" in e && e.toAccountId === id));

  const order = { bank: 0, credit_card: 1, cash: 2 } as Record<string, number>;
  const rows = state.accounts
    .filter((a) => a.account.type in order && (a.balanceMinor !== 0 || used(a.account.id) || checks.has(a.account.id)))
    .sort((a, b) => order[a.account.type] - order[b.account.type]);
  if (rows.length === 0) return null;

  return (
    // Phones: one row that swipes sideways (a bit of the next tile shows, so it's clear there's more); wider screens: a grid.
    <section
      aria-label="Your accounts"
      className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-2.5 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 xl:grid-cols-4 [&::-webkit-scrollbar]:hidden"
    >
      {rows.map(({ account, balanceMinor }) => {
        const card = account.type === "credit_card";
        const check = checks.get(account.id);
        // `state` already starts bank balances from the latest statement; name the statement while nothing has moved since.
        const asStatement = !!check && !card && balanceMinor === check.closingMinor;
        return (
          <div key={account.id} className="flex w-[42%] min-w-0 shrink-0 snap-start flex-col gap-1 glass rounded-xl border p-2.5 sm:w-auto sm:gap-1.5 sm:p-3" data-testid="account-tile">
            <Link
              href={activityHref({ account: account.id })}
              className="flex items-center gap-2 hover:underline max-sm:[&>span:first-child]:h-7 max-sm:[&>span:first-child]:max-w-11"
            >
              <AccountLogo account={account} bankHint={bankOf(account.id)} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900 sm:text-sm">
                {account.name}
                {check?.accountMask && <span className="font-normal text-slate-500"> ••{check.accountMask}</span>}
              </span>
            </Link>
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
              <span className="flex items-center gap-1 text-xs text-slate-500">
                {asStatement && check ? `Statement ${formatDisplayDate(check.date)}` : card ? "To pay" : "Available"}
                {(!check || card) && <AccountBalanceHow account={account} />}
              </span>
              <span className={cn("text-base font-semibold tabular-nums sm:text-lg", (card ? balanceMinor > 0 : balanceMinor < 0) ? "text-red-700" : "text-slate-900")}>
                {formatExactINR(card ? Math.max(balanceMinor, 0) : balanceMinor)}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** ⓘ beside an account's balance: its starting balance, then everything in and out, ending in the balance. */
function AccountBalanceHow({ account }: { account: Account }) {
  const { book, ledger, today } = useFinance();
  const how = useExplain();
  const debt = account.type === "credit_card" || account.type === "loan";
  const x = how.props.open ? explainAccountBalance(book, ledger, account.id, today) : null;
  return (
    <>
      <HowIcon onClick={how.open} label={`${account.name} balance`} />
      {x && (
        <ExplainSheet
          {...how.props}
          signed
          title={debt ? `What you owe on ${account.name}` : `${account.name}: how the balance adds up`}
          description={
            debt
              ? "The starting amount you owed, plus purchases and charges, less payments and refunds."
              : `The starting balance you set${x.openedOn && x.openedOn > "2000-01-01" ? ` (from ${formatDisplayDate(x.openedOn)})` : ""}, plus everything that came in, less everything that went out.`
          }
          sections={[{ title: debt ? "Since you started tracking" : "Money in and out", rows: x.lines.map((l) => ({ ...l, href: activityHref({ account: account.id }) })), empty: "No entries yet." }]}
          steps={[
            { label: debt ? "Owed at the start" : "Starting balance", amountMinor: x.startMinor },
            ...x.lines.map((l) => ({ label: l.label, amountMinor: Math.abs(l.amountMinor), op: (l.amountMinor >= 0 ? "+" : "−") as "+" | "−" })),
            debt && x.totalMinor < 0
              ? { label: "Paid more than the purchases recorded", amountMinor: -x.totalMinor, op: "=" as const }
              : { label: debt ? "To pay now" : "Balance now", amountMinor: x.totalMinor, op: "=" as const },
          ]}
        />
      )}
    </>
  );
}
