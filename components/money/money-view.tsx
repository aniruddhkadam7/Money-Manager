"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useUrlTab } from "../use-url-tab";
import { Calculator, CheckCircle2, HandCoins, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { activityHref } from "@/lib/charts/links";
import { bankBrandFor } from "@/lib/finance/bank-logos";
import { formatRupees } from "@/lib/finance/describe";
import { formatDisplayDate } from "@/lib/domain/dates";
import type { Account, AccountType, LoanTerms } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { useEventDialog } from "../events/event-dialog";
import { useQuickRepaymentReceived } from "../events/quick-repay";
import { useFinance } from "../finance-provider";
import { AccountLogo, useBankHints } from "../account-logo";
import { RangeTabs } from "../charts/primitives";
import { PageTitle } from "../page-title";
import { statementMatches, useBalances, useCardUsage, useStatementChecks, type StatementCheck } from "../statements/use-statement-checks";
import { ACCOUNT_TYPE_INFO, AccountDialog, InlineAccountForm, type AddableAccountType } from "./account-dialog";
import { PeopleList } from "./manage-lists";
import { LoanPanel } from "./loan-panel";
import { EmiCalculator } from "./emi-calculator";
import { emiOf, LOAN_KINDS, loanKindOf } from "@/lib/finance/loan";

/** Phones show the page a part at a time, like a phone app's tabs; wider screens show it all. (Categories and
 * Start over are in the profile's settings.) */
type Tab = "accounts" | "cards" | "loans" | "people";
const TABS: { value: Tab; label: string }[] = [
  { value: "accounts", label: "Accounts" },
  { value: "cards", label: "Cards" },
  { value: "loans", label: "Loans" },
  { value: "people", label: "People" },
];
/** Which tab a /money#section link lands on. */
const TAB_OF: Record<string, Tab> = { owed: "people", owe: "people", "cards-loans": "cards", loans: "loans" };

const SECTIONS: { id: string; tab: Tab; title: string; types: AccountType[]; add: { type: AddableAccountType; label: string }[]; empty?: string }[] = [
  { id: "accounts", tab: "accounts", title: "Bank & cash", types: ["bank", "cash"], add: [{ type: "bank", label: "Add bank" }] },
  // "cards-loans" stays the cards' anchor: links from Home (Liabilities) use it.
  { id: "cards-loans", tab: "cards", title: "Credit cards", types: ["credit_card"], add: [{ type: "credit_card", label: "Add card" }] },
  {
    id: "loans",
    tab: "loans",
    title: "Loans",
    types: ["loan"],
    add: [{ type: "loan", label: "Loan" }],
    empty: "Nothing to pay. Add a bank loan (home, car, personal) with its rate and tenure for its EMI, schedule and reminders, or money you borrowed from someone.",
  },
];

/**
 * Loans in the order of their purpose (Home, Car / vehicle, Personal…), biggest first within each; the first of
 * each purpose carries its heading, with what's owed on all of them.
 */
function byLoanKind<T extends { account: Account; balanceMinor: number }>(rows: T[]): (T & { group?: { label: string; owedMinor: number } })[] {
  const order = new Map(LOAN_KINDS.map((k, i) => [k.value, i]));
  const kindOf = (r: T) => loanKindOf(r.account);
  const sorted = [...rows].sort((a, b) => order.get(kindOf(a))! - order.get(kindOf(b))! || b.balanceMinor - a.balanceMinor);
  return sorted.map((r, i) => {
    const kind = kindOf(r);
    if (i > 0 && kindOf(sorted[i - 1]) === kind) return r;
    const owedMinor = sorted.filter((x) => kindOf(x) === kind).reduce((t, x) => t + Math.max(x.balanceMinor, 0), 0);
    return { ...r, group: { label: LOAN_KINDS.find((k) => k.value === kind)!.label, owedMinor } };
  });
}

/** A big tap target with an icon, a title and a hint: the Loans tab's two tiles. */
function Tile({ icon, title, hint, active, onClick }: { icon: ReactNode; title: string; hint: string; active?: boolean; onClick: () => void }) {
  // A quick second tap (a double tap) is ignored: it would close what the first one just opened.
  const lastTap = useRef(0);
  return (
    <button
      type="button"
      onClick={() => {
        const now = performance.now();
        if (now - lastTap.current < 500) return;
        lastTap.current = now;
        onClick();
      }}
      aria-pressed={active}
      className={cn(
        // touch-manipulation: no double-tap zoom on phones, so taps act at once.
        "glass flex min-h-24 touch-manipulation flex-col items-start justify-between gap-2 rounded-2xl border p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:p-4",
        active && "border-primary/60 bg-primary/5",
      )}
    >
      <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary">{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

/** Phones: the section's add button reads as a plain green link, like a phone app's list header. */
const ACTION = "max-sm:h-8 max-sm:border-0 max-sm:bg-transparent max-sm:px-2 max-sm:text-emerald-700 max-sm:shadow-none";

/** A section's title with its total beside it, and its add button on the right. */
function SectionHead({ title, total, action }: { title: string; total?: string; action?: ReactNode }) {
  return (
    // The title and total stay on one line; on a very narrow screen the buttons move under them, on the right.
    <CardHeader className="flex-wrap gap-x-3 gap-y-1 max-sm:px-4 max-sm:pt-4">
      <div className="flex min-w-0 items-baseline gap-2">
        <CardTitle className="whitespace-nowrap">{title}</CardTitle>
        {total && <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{total}</span>}
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
  const [calcOpen, setCalcOpen] = useState(false);
  const owedPeople = state.people.filter((p) => p.iOwe.outstandingMinor > 0).sort((a, b) => b.iOwe.outstandingMinor - a.iOwe.outstandingMinor);
  const toPayMinor =
    state.accounts.filter((a) => a.account.type === "loan").reduce((t, a) => t + Math.max(a.balanceMinor, 0), 0) +
    owedPeople.reduce((t, p) => t + p.iOwe.outstandingMinor, 0);
  // Adding a loan on the page (its form under the tiles), maybe from the calculator's figures.
  const [addingLoan, setAddingLoan] = useState<{ terms?: LoanTerms } | null>(null);
  const [planning, setPlanning] = useState<{ account: Account; owedMinor: number; monthsLeft: number } | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; editing: Account | null; adding?: AddableAccountType; loanTerms?: LoanTerms }>({ open: false, editing: null });
  const [tab, setTab] = useUrlTab(TABS);
  const hide = (t: Tab) => (tab !== t ? "max-sm:hidden" : undefined);

  // Links like /money#loans jump straight to that section once the page has loaded.
  useEffect(() => {
    if (status !== "ready") return;
    const id = window.location.hash.slice(1);
    if (!id) return;
    // Replaced, not a new step: the link itself was the step here.
    setTab(TAB_OF[id] ?? "accounts", { replace: true });
    // After the tab has switched, so the section is on screen to scroll to.
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [status]);

  if (status === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;


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
          <Fragment key={section.title}>
          {/* The Loans tab: two tiles side by side. "Loans" lists everyone you have to pay (bank loans and people you
              borrowed from), with adding right there; "EMI calculator" opens the calculator in its place. */}
          {section.id === "loans" && (
            <>
              <div className={cn("grid grid-cols-2 gap-3 sm:gap-4", hide("loans"))} data-testid="loan-tiles">
                <Tile
                  icon={<HandCoins className="size-5" />}
                  title="Loans"
                  hint={toPayMinor > 0 ? `${formatRupees(toPayMinor)} to pay` : "Nothing to pay"}
                  active={!calcOpen && !planning}
                  onClick={() => {
                    setCalcOpen(false);
                    setPlanning(null);
                  }}
                />
                <Tile
                  icon={<Calculator className="size-5" />}
                  title="EMI calculator"
                  hint="EMI, interest, plans"
                  active={calcOpen || !!planning}
                  onClick={() => {
                    setCalcOpen(true);
                    setAddingLoan(null);
                  }}
                />
              </div>
              {addingLoan && !calcOpen && !planning && (
                <Card className={cn("scroll-mt-24", hide("loans"))} id="add-loan" data-testid="add-loan-inline">
                  <CardContent className="pt-5 max-sm:px-4">
                    <InlineAccountForm
                      // From the calculator's "Add as a loan": starts from its figures.
                      key={addingLoan.terms ? JSON.stringify(addingLoan.terms) : "blank"}
                      adding="loan"
                      loanTerms={addingLoan.terms}
                      onDone={() => setAddingLoan(null)}
                    />
                  </CardContent>
                </Card>
              )}
              {(calcOpen || planning) && (
                <EmiCalculator
                  // A new loan to plan starts the calculator afresh from it.
                  key={planning ? `plan-${planning.account.id}-${planning.owedMinor}` : "blank"}
                  planning={planning ?? undefined}
                  onStopPlanning={() => setPlanning(null)}
                  onClose={() => {
                    setCalcOpen(false);
                    setPlanning(null);
                  }}
                  className={cn("scroll-mt-24", hide("loans"))}
                  onAddLoan={(terms) => {
                    // The calculator's figures become the new loan, opened in place of the calculator.
                    setAddingLoan({ terms });
                    setCalcOpen(false);
                    setPlanning(null);
                    requestAnimationFrame(() => document.getElementById("add-loan")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                  }}
                />
              )}
            </>
          )}
          {(section.id !== "loans" || (!calcOpen && !planning)) && (
          <Card id={section.id} className={cn("scroll-mt-24", hide(section.tab))}>
            <SectionHead
              title={section.id === "loans" ? "Whom you pay" : section.title}
              total={
                section.id === "loans"
                  ? toPayMinor > 0
                    ? formatRupees(toPayMinor)
                    : undefined
                  : rows.length > 0
                    ? formatRupees(rows.reduce((t, a) => t + shown(a), 0))
                    : undefined
              }
              action={
                <div className="ml-auto flex shrink-0 gap-2 whitespace-nowrap max-sm:gap-0">
                  {section.id === "loans" && (
                    <Button size="sm" variant="outline" className={ACTION} aria-label="Add money you borrowed from someone" title="Money you borrowed from someone" onClick={() => openAdd("borrow")} data-testid="add-borrowed">
                      <Plus /> Person
                    </Button>
                  )}
                  {section.add.map((a) => (
                    <Button key={a.type} size="sm" variant="outline" className={ACTION} onClick={() => {
                      // A loan is added on the page, under the tiles; other accounts in a dialog.
                      if (a.type === "loan") {
                        setAddingLoan({});
                        setCalcOpen(false);
                        setPlanning(null);
                        requestAnimationFrame(() => document.getElementById("add-loan")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                      } else setDialog({ open: true, editing: null, adding: a.type });
                    }}>
                      <Plus /> {a.label}
                    </Button>
                  ))}
                </div>
              }
            />
            {rows.length === 0 && !(section.id === "loans" && owedPeople.length > 0) ? (
              <CardContent className="grid justify-items-start gap-3 py-6 text-sm text-muted-foreground">
                <p>{section.empty ?? "None yet."}</p>
              </CardContent>
            ) : (
              <ul className="divide-y py-2">
                {(section.id === "loans" ? byLoanKind(rows) : rows.map((r) => ({ ...r, group: undefined }))).map(({ account, balanceMinor, group }) => {
                  // A card shows what's left to spend, as its bank's app does.
                  const usage = account.type === "credit_card" ? usageOf(account, balanceMinor) : null;
                  return (
                  <Fragment key={account.id}>
                  {/* Loans: a heading for each purpose (Home, Car / vehicle…) with what's owed on them. */}
                  {group && (
                    <li className="flex items-baseline justify-between bg-muted/40 px-4 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5" data-testid="loan-group">
                      <span>{group.label}</span>
                      <span className="tabular-nums">{formatRupees(group.owedMinor)}</span>
                    </li>
                  )}
                  <AccountRow
                    account={account}
                    bankHint={bankOf(account.id)}
                    wide={wide}
                    detail={
                      usage
                        ? usage.dueMinor > 0
                          ? `${formatRupees(usage.dueMinor)} due${usage.dueDate ? ` by ${formatDisplayDate(usage.dueDate)}` : ""}`
                          : `${formatRupees(usage.usedMinor)} used of ${formatRupees(usage.limitMinor)}`
                        : account.type === "loan" && account.loanTerms
                          ? `Loan · EMI ${formatRupees(emiOf(account.loanTerms))} · ${account.loanTerms.annualRateBps / 100}%`
                          : ACCOUNT_TYPE_INFO[account.type].label
                    }
                    value={formatRupees(usage ? usage.availableMinor : shown({ account, balanceMinor }))}
                    startingCash={account.type === "cash" && balanceMinor < 0 ? -balanceMinor : undefined}
                    caption={usage ? "available" : account.type === "loan" ? "owed" : undefined}
                    statement={account.type === "bank" || account.type === "cash" ? statements.get(account.id) : undefined}
                    onEdit={() => setDialog({ open: true, editing: account })}
                  >
                    {account.type === "loan" && (
                      <LoanPanel
                        account={account}
                        owedMinor={balanceMinor}
                        onAddDetails={() => setDialog({ open: true, editing: account })}
                        onPlan={(monthsLeft) => {
                          setPlanning({ account, owedMinor: balanceMinor, monthsLeft });
                          // After it opens on this loan, bring the calculator into view.
                          requestAnimationFrame(() => document.getElementById("emi-calculator")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                        }}
                      />
                    )}
                  </AccountRow>
                  </Fragment>
                  );
                })}
                {/* People you borrowed from and still owe: who, how much, and a way to pay them back. */}
                {section.id === "loans" && owedPeople.length > 0 && (
                  <>
                    <li className="flex items-baseline justify-between bg-muted/40 px-4 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5" data-testid="loan-group">
                      <span>People</span>
                      <span className="tabular-nums">{formatRupees(owedPeople.reduce((t, p) => t + p.iOwe.outstandingMinor, 0))}</span>
                    </li>
                    {owedPeople.map((p) => (
                      <li key={p.person.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5 sm:py-3" data-testid="owed-person">
                        <Link href={activityHref({ person: p.person.id })} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-indigo-500/15 text-base font-semibold text-indigo-600 dark:text-indigo-300">
                            {p.person.name.charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{p.person.name}</span>
                            <span className="block truncate text-sm text-muted-foreground">
                              Borrowed {formatRupees(p.iOwe.originalMinor)}
                              {p.iOwe.originalMinor > p.iOwe.outstandingMinor && ` · paid back ${formatRupees(p.iOwe.originalMinor - p.iOwe.outstandingMinor)}`}
                            </span>
                          </span>
                        </Link>
                        <p className="shrink-0 text-right font-semibold tabular-nums">
                          {formatRupees(p.iOwe.outstandingMinor)}
                          <span className="block text-xs font-normal text-muted-foreground">owed</span>
                        </p>
                        <Button size="sm" variant="outline" onClick={() => openAdd("repayment_made", { person: p.person.name })}>
                          Pay back
                        </Button>
                      </li>
                    ))}
                  </>
                )}
              </ul>
            )}
          </Card>
          )}
          </Fragment>
        );
      })}

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
        loanTerms={dialog.loanTerms}
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
  children,
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
  /** More about it, under the row (a loan's EMI and schedule). */
  children?: ReactNode;
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
      {children}
    </li>
  );
}
