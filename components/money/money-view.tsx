"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { activityHref } from "@/lib/charts/links";
import { formatRupees } from "@/lib/finance/describe";
import { formatDisplayDate } from "@/lib/domain/dates";
import { deriveState } from "@/lib/finance/state";
import type { Account, AccountType } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { useEventDialog } from "../events/event-dialog";
import { useQuickRepaymentReceived } from "../events/quick-repay";
import { useFinance } from "../finance-provider";
import { PictureIcon } from "../picture-icon";
import { useStatements } from "../statements/statements-provider";
import { ACCOUNT_TYPE_INFO, AccountDialog } from "./account-dialog";
import { ManageLists } from "./manage-lists";
import { ResetApp } from "./reset-app";

const SECTIONS: { id: string; title: string; types: AccountType[] }[] = [
  { id: "accounts", title: "Bank & cash", types: ["bank", "cash"] },
  { id: "cards-loans", title: "Cards & loans", types: ["credit_card", "loan"] },
];

export function MoneyView() {
  const { status, state, book, ledger, missingStandardAccounts, restoreStandardAccounts } = useFinance();
  const { imports } = useStatements();

  /**
   * Each bank or cash account's latest statement: its closing balance, and what the app says the account
   * held on that same day. A difference there means an entry up to that date doesn't match the bank.
   */
  const statements = useMemo(() => {
    const out = new Map<string, StatementCheck>();
    for (const i of imports) {
      if (i.status === "FAILED" || i.closingBalanceMinor == null || !i.periodEnd) continue;
      const prev = out.get(i.accountId);
      if (!prev || i.periodEnd > prev.date) out.set(i.accountId, { date: i.periodEnd, closingMinor: i.closingBalanceMinor, appMinor: 0 });
    }
    for (const [accountId, check] of out) {
      check.appMinor = deriveState(book, ledger, check.date).accounts.find((a) => a.account.id === accountId)?.balanceMinor ?? 0;
    }
    return out;
  }, [imports, book, ledger]);
  const { openAdd } = useEventDialog();
  const theyPaidMe = useQuickRepaymentReceived();
  const [dialog, setDialog] = useState<{ open: boolean; editing: Account | null }>({ open: false, editing: null });

  // Links like /money#investments jump straight to that section once the page has loaded.
  useEffect(() => {
    if (status !== "ready") return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [status]);

  if (status === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;

  const owedToMe = state.people.filter((p) => p.owedToMe.originalMinor > 0 || p.owedToMe.outstandingMinor > 0);
  const iOwe = state.people.filter((p) => p.iOwe.originalMinor > 0 || p.iOwe.outstandingMinor > 0);

  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-4 sm:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Money</h1>
          <p className="text-sm text-muted-foreground">Cash, UPI and cards are ready to use. Tap the pencil to set what each one holds today.</p>
        </div>
        {missingStandardAccounts.length > 0 && (
          <Button variant="outline" size="sm" onClick={restoreStandardAccounts}>
            Restore {missingStandardAccounts.map((a) => a.name).join(", ")}
          </Button>
        )}
      </div>

      {SECTIONS.map((section) => {
        const rows = state.accounts.filter((a) => section.types.includes(a.account.type));
        return (
          <Card key={section.title} id={section.id} className="scroll-mt-24">
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              {section.id === "cards-loans" && (
                <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, editing: null })}>
                  <Plus /> Add loan
                </Button>
              )}
            </CardHeader>
            {rows.length === 0 ? (
              <CardContent className="py-6 text-sm text-muted-foreground">None yet.</CardContent>
            ) : (
              <ul className="divide-y py-2">
                {rows.map(({ account, balanceMinor }) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    detail={ACCOUNT_TYPE_INFO[account.type].label}
                    value={formatRupees(balanceMinor)}
                    caption={account.type === "credit_card" || account.type === "loan" ? "owed" : undefined}
                    statement={account.type === "bank" || account.type === "cash" ? statements.get(account.id) : undefined}
                    onEdit={() => setDialog({ open: true, editing: account })}
                  />
                ))}
              </ul>
            )}
          </Card>
        );
      })}

      <Card id="investments" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Investments</CardTitle>
          <Button size="sm" variant="outline" onClick={() => openAdd("invest")}>
            <Plus /> Invest
          </Button>
        </CardHeader>
        {state.investments.holdings.length === 0 ? (
          <CardContent className="py-6 text-sm text-muted-foreground">
            Nothing invested yet. Use “Invest” when you put money into a fund, stock or gold.
          </CardContent>
        ) : (
          <>
            <ul className="divide-y py-2">
              {state.investments.holdings.map((h) => (
                <li key={h.account.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <PictureIcon name="invest" tile />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{h.account.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      You put in {formatRupees(h.costBasisMinor)} ·{" "}
                      <span className={cn(h.gainMinor > 0 && "text-emerald-700", h.gainMinor < 0 && "text-red-700")}>
                        {h.gainMinor >= 0 ? "Gain" : "Loss"} {formatRupees(Math.abs(h.gainMinor))}
                      </span>
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums">{formatRupees(h.valueMinor)}</p>
                  <Button size="sm" variant="outline" onClick={() => openAdd("update_valuation", { holdingId: h.account.id })}>
                    Update value
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${h.account.name}`} onClick={() => setDialog({ open: true, editing: h.account })}>
                    <Pencil />
                  </Button>
                </li>
              ))}
            </ul>
            <p className="border-t px-5 py-3 text-sm text-muted-foreground">
              Total {formatRupees(state.investments.valueMinor)} · put in {formatRupees(state.investments.costBasisMinor)} ·{" "}
              {state.investments.gainMinor >= 0 ? "gain" : "loss"} {formatRupees(Math.abs(state.investments.gainMinor))}
            </p>
          </>
        )}
      </Card>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card id="owed" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Money others owe you</CardTitle>
            <Button size="sm" variant="outline" onClick={() => openAdd("lend")}>
              <Plus /> Lend
            </Button>
          </CardHeader>
          {owedToMe.length === 0 ? (
            <CardContent className="py-6 text-sm text-muted-foreground">Nobody owes you anything.</CardContent>
          ) : (
            <ul className="divide-y py-2">
              {owedToMe.map((p) => (
                <li key={p.person.id} className="grid gap-1 px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={activityHref({ person: p.person.id })} className="font-medium hover:text-emerald-700 hover:underline">{p.person.name}</Link>
                    <p className="font-semibold tabular-nums">{formatRupees(p.owedToMe.outstandingMinor)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span>
                      Original {formatRupees(p.owedToMe.originalMinor)} · paid back {formatRupees(p.owedToMe.receivedMinor)}
                    </span>
                    {p.owedToMe.outstandingMinor > 0 && (
                      <button
                        className="font-medium text-primary hover:underline"
                        onClick={() => theyPaidMe(p.person.id)}
                        title="Records the full amount as paid back today"
                      >
                        They paid me
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card id="owe" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Money you owe people</CardTitle>
            <Button size="sm" variant="outline" onClick={() => openAdd("borrow")}>
              <Plus /> Borrow
            </Button>
          </CardHeader>
          {iOwe.length === 0 ? (
            <CardContent className="py-6 text-sm text-muted-foreground">You don&apos;t owe anyone.</CardContent>
          ) : (
            <ul className="divide-y py-2">
              {iOwe.map((p) => (
                <li key={p.person.id} className="grid gap-1 px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={activityHref({ person: p.person.id })} className="font-medium hover:text-emerald-700 hover:underline">{p.person.name}</Link>
                    <p className="font-semibold tabular-nums">{formatRupees(p.iOwe.outstandingMinor)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span>
                      Borrowed {formatRupees(p.iOwe.originalMinor)} · repaid {formatRupees(p.iOwe.repaidMinor)}
                    </span>
                    {p.iOwe.outstandingMinor > 0 && (
                      <button
                        className="font-medium text-primary hover:underline"
                        onClick={() => openAdd("repayment_made", { person: p.person.name })}
                      >
                        I paid back
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ManageLists />

      <ResetApp />

      <AccountDialog
        open={dialog.open}
        editing={dialog.editing}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}

interface StatementCheck {
  /** Last day the statement covers (`YYYY-MM-DD`). */
  date: string;
  closingMinor: number;
  /** The app's balance for the account at the end of that day. */
  appMinor: number;
}

function AccountRow({
  account,
  detail,
  value,
  caption,
  statement,
  onEdit,
}: {
  account: Account;
  detail: string;
  value: string;
  caption?: string;
  statement?: StatementCheck;
  onEdit: () => void;
}) {
  const info = ACCOUNT_TYPE_INFO[account.type];
  // Under a rupee apart counts as matching: statements round, and a paisa off isn't worth a warning.
  const diff = statement ? statement.appMinor - statement.closingMinor : 0;
  const off = Math.abs(diff) >= 100;
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <PictureIcon name={info.picture} tile />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{account.name}</p>
        <p className="truncate text-sm text-muted-foreground">{detail}</p>
        {statement && (
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="statement-balance">
            Bank statement: <span className="font-medium text-foreground">{formatRupees(statement.closingMinor)}</span> on {formatDisplayDate(statement.date)}
            {off ? (
              <Link
                href={activityHref({ account: account.id, to: statement.date })}
                className="mt-0.5 block font-medium text-amber-700 hover:underline"
              >
                The app shows {formatRupees(Math.abs(diff))} {diff > 0 ? "more" : "less"} on that day: an entry doesn&apos;t match the bank. Check entries →
              </Link>
            ) : (
              <span className="text-emerald-700"> · matches</span>
            )}
          </p>
        )}
      </div>
      <p className="shrink-0 text-right font-semibold tabular-nums">
        {value}
        {caption && <span className="block text-xs font-normal text-muted-foreground">{caption}</span>}
      </p>
      <Link href={`/activity?account=${account.id}`} className="hidden text-sm font-medium text-emerald-700 hover:underline sm:inline">
        Entries
      </Link>
      <Button variant="ghost" size="icon" aria-label={`Edit ${account.name}`} title="Edit" onClick={onEdit}>
        <Pencil />
      </Button>
    </li>
  );
}
