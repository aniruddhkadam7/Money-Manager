"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Pencil, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { activityHref } from "@/lib/charts/links";
import { bankBrandFor } from "@/lib/finance/bank-logos";
import { formatRupees } from "@/lib/finance/describe";
import { formatDisplayDate } from "@/lib/domain/dates";
import type { Account, AccountType } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { useEventDialog } from "../events/event-dialog";
import { useQuickRepaymentReceived } from "../events/quick-repay";
import { useFinance } from "../finance-provider";
import { AccountLogo, useBankHints } from "../account-logo";
import { RangeTabs } from "../charts/primitives";
import { PageTitle } from "../page-title";
import { PictureIcon } from "../picture-icon";
import { statementMatches, useBalances, useCardUsage, useStatementChecks, type StatementCheck } from "../statements/use-statement-checks";
import { ACCOUNT_TYPE_INFO, AccountDialog, type AddableAccountType } from "./account-dialog";
import { PeopleList } from "./manage-lists";

/** Phones show the page a part at a time, like a phone app's tabs; wider screens show it all. (Categories and
 * Start over are in the profile's settings.) */
type Tab = "accounts" | "people";
const TABS: { value: Tab; label: string }[] = [
  { value: "accounts", label: "Accounts" },
  { value: "people", label: "People" },
];
/** Which tab a /money#section link lands on. */
const TAB_OF: Record<string, Tab> = { owed: "people", owe: "people" };

const SECTIONS: { id: string; title: string; types: AccountType[]; add: { type: AddableAccountType; label: string }[] }[] = [
  { id: "accounts", title: "Bank & cash", types: ["bank", "cash"], add: [{ type: "bank", label: "Add bank" }] },
  {
    id: "cards-loans",
    title: "Cards & loans",
    types: ["credit_card", "loan"],
    add: [{ type: "credit_card", label: "Add card" }],
  },
];

/** Phones: the section's add button reads as a plain green link, like a phone app's list header. */
const ACTION = "max-sm:h-8 max-sm:border-0 max-sm:bg-transparent max-sm:px-2 max-sm:text-emerald-700 max-sm:shadow-none";

/** A section's title with its total beside it, and its add button on the right. */
function SectionHead({ title, total, action }: { title: string; total?: string; action?: ReactNode }) {
  return (
    <CardHeader className="gap-3 max-sm:px-4 max-sm:pt-4">
      <div className="flex min-w-0 items-baseline gap-2">
        <CardTitle>{title}</CardTitle>
        {total && <span className="text-sm font-semibold tabular-nums text-foreground">{total}</span>}
      </div>
      {action}
    </CardHeader>
  );
}

export function MoneyView() {
  const { status } = useFinance();
  // Bank balances as the latest statements say, so these match Home.
  const { state } = useBalances();
  const statements = useStatementChecks();
  const bankOf = useBankHints();
  const usageOf = useCardUsage();
  const { openAdd } = useEventDialog();
  const theyPaidMe = useQuickRepaymentReceived();
  const [dialog, setDialog] = useState<{ open: boolean; editing: Account | null; adding?: AddableAccountType }>({ open: false, editing: null });
  const [tab, setTab] = useState<Tab>("accounts");
  const hide = (t: Tab) => (tab !== t ? "max-sm:hidden" : undefined);

  // Links like /money#investments jump straight to that section once the page has loaded.
  useEffect(() => {
    if (status !== "ready") return;
    const id = window.location.hash.slice(1);
    if (!id) return;
    setTab(TAB_OF[id] ?? "accounts");
    // After the tab has switched, so the section is on screen to scroll to.
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [status]);

  if (status === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;

  // Stocks are traded share by share on the Investments page; here, what's held by amount (funds, gold…).
  const holdings = state.investments.holdings.filter((h) => !h.account.style);
  const sum = (f: (h: (typeof holdings)[number]) => number) => holdings.reduce((t, h) => t + f(h), 0);
  const stocks = state.investments.holdings.length - holdings.length;

  const owedToMe = state.people.filter((p) => p.owedToMe.originalMinor > 0 || p.owedToMe.outstandingMinor > 0);
  const iOwe = state.people.filter((p) => p.iOwe.originalMinor > 0 || p.iOwe.outstandingMinor > 0);

  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-4 sm:gap-6">
      <PageTitle>Money</PageTitle>

      <div className="sm:hidden">
        <RangeTabs label="Show" value={tab} options={TABS} onChange={setTab} />
      </div>

      {SECTIONS.map((section) => {
        const rows = state.accounts.filter((a) => section.types.includes(a.account.type));
        // With a bank logo in the list, every row's picture sits in the logo's width so the names line up.
        const wide = rows.some((a) => bankBrandFor(a.account.name, bankOf(a.account.id)));
        // Cash below zero only means the starting cash was never set: show nothing left, not a debt. A card counts
        // what's taken from its limit (the unpaid bill and spending since), never a payment beyond its purchases.
        const shown = (a: { account: Account; balanceMinor: number }) =>
          a.account.type === "cash" ? Math.max(a.balanceMinor, 0) : a.account.type === "credit_card" ? usageOf(a.account, a.balanceMinor).usedMinor : a.balanceMinor;
        return (
          <Card key={section.title} id={section.id} className={cn("scroll-mt-24", hide("accounts"))}>
            <SectionHead
              title={section.title}
              total={rows.length > 0 ? formatRupees(rows.reduce((t, a) => t + shown(a), 0)) : undefined}
              action={
                <div className="flex gap-2 max-sm:gap-0">
                  {section.add.map((a) => (
                    <Button key={a.type} size="sm" variant="outline" className={ACTION} onClick={() => setDialog({ open: true, editing: null, adding: a.type })}>
                      <Plus /> {a.label}
                    </Button>
                  ))}
                </div>
              }
            />
            {rows.length === 0 ? (
              <CardContent className="py-6 text-sm text-muted-foreground">None yet.</CardContent>
            ) : (
              <ul className="divide-y py-2">
                {rows.map(({ account, balanceMinor }) => {
                  // A card shows what's left to spend, as its bank's app does.
                  const usage = account.type === "credit_card" ? usageOf(account, balanceMinor) : null;
                  return (
                  <AccountRow
                    key={account.id}
                    account={account}
                    bankHint={bankOf(account.id)}
                    wide={wide}
                    detail={
                      usage
                        ? usage.dueMinor > 0
                          ? `${formatRupees(usage.dueMinor)} due${usage.dueDate ? ` by ${formatDisplayDate(usage.dueDate)}` : ""}`
                          : `${formatRupees(usage.usedMinor)} used of ${formatRupees(usage.limitMinor)}`
                        : ACCOUNT_TYPE_INFO[account.type].label
                    }
                    value={formatRupees(usage ? usage.availableMinor : shown({ account, balanceMinor }))}
                    startingCash={account.type === "cash" && balanceMinor < 0 ? -balanceMinor : undefined}
                    caption={usage ? "available" : account.type === "loan" ? "owed" : undefined}
                    statement={account.type === "bank" || account.type === "cash" ? statements.get(account.id) : undefined}
                    onEdit={() => setDialog({ open: true, editing: account })}
                  />
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}

      <Card id="investments" className={cn("scroll-mt-24", hide("accounts"))}>
        <SectionHead
          title="Investments"
          total={holdings.length > 0 ? formatRupees(sum((h) => h.valueMinor)) : undefined}
          action={
            <Button size="sm" variant="outline" className={ACTION} onClick={() => openAdd("invest")}>
              <Plus /> Invest
            </Button>
          }
        />
        {stocks > 0 && (
          <Link href="/investments" className="mx-4 mb-1 block rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground hover:text-foreground sm:mx-5">
            Stocks ({stocks}) are on the <span className="font-medium text-primary">Investments</span> page, with positions and P&amp;L.
          </Link>
        )}
        {holdings.length === 0 ? (
          stocks === 0 && (
          <CardContent className="py-6 text-sm text-muted-foreground">
            Nothing invested yet. Use “Invest” to add one.
          </CardContent>
          )
        ) : (
          <>
            <ul className="divide-y py-2">
              {holdings.map((h) => (
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
                  {/* Phones: an icon, so the holding's name and gain keep their room. */}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Update the value of ${h.account.name}`}
                    title="Update value"
                    className="max-sm:size-9 max-sm:px-0"
                    onClick={() => openAdd("update_valuation", { holdingId: h.account.id })}
                  >
                    <RefreshCw className="sm:hidden" />
                    <span className="max-sm:hidden">Update value</span>
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${h.account.name}`} onClick={() => setDialog({ open: true, editing: h.account })}>
                    <Pencil />
                  </Button>
                </li>
              ))}
            </ul>
            {/* Phones: the header already has the total. */}
            <p className="border-t px-5 py-3 text-sm text-muted-foreground max-sm:hidden">
              Total {formatRupees(sum((h) => h.valueMinor))} · put in {formatRupees(sum((h) => h.costBasisMinor))} ·{" "}
              {sum((h) => h.gainMinor) >= 0 ? "gain" : "loss"} {formatRupees(Math.abs(sum((h) => h.gainMinor)))}
            </p>
          </>
        )}
      </Card>

      <div className="grid gap-4 max-sm:contents sm:gap-6 lg:grid-cols-2">
        <Card id="owed" className={cn("scroll-mt-24", hide("people"))}>
          <SectionHead
            title="Money others owe you"
            total={owedToMe.length > 0 ? formatRupees(owedToMe.reduce((t, p) => t + p.owedToMe.outstandingMinor, 0)) : undefined}
            action={
              <Button size="sm" variant="outline" className={ACTION} onClick={() => openAdd("lend")}>
                <Plus /> Lend
              </Button>
            }
          />
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
                      {p.offsetMinor > 0 && <> · less {formatRupees(p.offsetMinor)} you owe them</>}
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

        <Card id="owe" className={cn("scroll-mt-24", hide("people"))}>
          <SectionHead
            title="Money you owe people"
            total={iOwe.length > 0 ? formatRupees(iOwe.reduce((t, p) => t + p.iOwe.outstandingMinor, 0)) : undefined}
            action={
              <Button size="sm" variant="outline" className={ACTION} onClick={() => openAdd("borrow")}>
                <Plus /> Borrow
              </Button>
            }
          />
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
                      {p.offsetMinor > 0 && <> · less {formatRupees(p.offsetMinor)} they owe you</>}
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

      <PeopleList className={hide("people")} />

      <AccountDialog
        open={dialog.open}
        editing={dialog.editing}
        adding={dialog.adding}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}

function AccountRow({
  account,
  bankHint,
  wide,
  detail,
  value,
  startingCash,
  caption,
  statement,
  onEdit,
}: {
  account: Account;
  bankHint?: string;
  wide: boolean;
  detail: string;
  value: string;
  /** Cash spent beyond the starting cash you set: the starting cash is missing, not a debt. */
  startingCash?: number;
  caption?: string;
  statement?: StatementCheck;
  onEdit: () => void;
}) {
  const off = statement ? !statementMatches(statement) : false;
  return (
    <li className="px-4 py-2.5 sm:px-5 sm:py-3">
      <div className="flex items-center gap-3">
      {/* The logo and name open the account's entries (phones have no room for the Entries link). */}
      <Link href={`/activity?account=${account.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className={cn("flex shrink-0", wide && "w-16")}>
        <AccountLogo account={account} bankHint={bankHint} tile />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{account.name}</p>
        <p className="truncate text-sm text-muted-foreground">{detail}</p>
        {startingCash !== undefined && (
          <p className="mt-0.5 truncate text-xs text-amber-700" data-testid="starting-cash" title="Tap the pencil and enter how much cash you had before these entries.">
            {formatRupees(startingCash)} spent · set your starting cash
          </p>
        )}
        {statement && !off && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-emerald-700" data-testid="statement-balance">
            <CheckCircle2 className="size-3.5 shrink-0" /> Matches bank on {formatDisplayDate(statement.date)}
          </p>
        )}
        {statement && off && (
          <p className="mt-0.5 truncate text-xs text-amber-700" data-testid="statement-gap" title="The balance follows the bank statement; your entries up to that day add up to a different amount.">
            As per statement {formatDisplayDate(statement.date)} · {formatRupees(statement.closingMinor - statement.appMinor)} not in your entries
          </p>
        )}
      </div>
      </Link>
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
      </div>
    </li>
  );
}
