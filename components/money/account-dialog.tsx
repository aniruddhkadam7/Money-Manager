"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDisplayDate, todayISO } from "@/lib/domain/dates";
import { BANK_BRANDS } from "@/lib/finance/bank-logos";
import { accountIdsUsedBy } from "@/lib/finance/book-ops";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import type { Account, AccountType, TradeStyle } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";
import { useBalances } from "../statements/use-statement-checks";
import { StylePicker } from "../investments/style-picker";
import { LoanFields, loanFieldValues, parseLoanFields } from "./loan-fields";
import { LOAN_KINDS, loanKindOf, plannedOwedOn } from "@/lib/finance/loan";
import type { LoanKind, LoanTerms } from "@/lib/finance/types";
import { formatRupees } from "@/lib/finance/describe";
import { type PictureName } from "../picture-icon";

export const ACCOUNT_TYPE_INFO: Record<AccountType, { label: string; picture: PictureName; balanceLabel: string }> = {
  bank: { label: "Bank / UPI", picture: "bank", balanceLabel: "Balance today" },
  cash: { label: "Cash", picture: "cash", balanceLabel: "Balance today" },
  credit_card: { label: "Credit card", picture: "credit-card", balanceLabel: "Amount you owe now" },
  loan: { label: "Loan", picture: "loan", balanceLabel: "Amount you still owe" },
  investment: { label: "Investment", picture: "invest", balanceLabel: "Current value" },
};

/** Blank or zero means no starting balance; anything else must be a valid amount. */
function parseOpeningBalance(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (cleaned === "" || /^0+(\.0{1,2})?$/.test(cleaned)) return 0;
  return parseAmountToMinor(cleaned);
}

/** The kinds of account that can be added here (investments are added with "Invest"). */
export type AddableAccountType = "bank" | "cash" | "credit_card" | "loan";

/** Card issuers that aren't banks you'd hold a savings account with. */
const CARD_ONLY = new Set(["bank-sbicard", "bank-onecard", "bank-amex"]);

const ADD_INFO: Record<AddableAccountType, { title: string; description: string; placeholder: string; submit: string; suggestions: string[] }> = {
  bank: {
    title: "Add a bank account",
    description: "A savings or current account. Its bank's logo shows up on its own.",
    placeholder: "e.g. HDFC Bank",
    submit: "Add bank",
    suggestions: BANK_BRANDS.filter((b) => !CARD_ONLY.has(b.slug)).map((b) => b.name),
  },
  cash: {
    title: "Add cash",
    description: "Cash you keep somewhere, like a purse or at home.",
    placeholder: "e.g. Cash at home",
    submit: "Add",
    suggestions: [],
  },
  credit_card: {
    title: "Add a credit card",
    description: "Enter what you owe on it today. Pay its bill with a Transfer.",
    placeholder: "e.g. ICICI Credit Card",
    submit: "Add card",
    suggestions: BANK_BRANDS.map((b) => (CARD_ONLY.has(b.slug) ? b.name : `${b.name.replace(/ Bank$/, "")} Credit Card`)),
  },
  loan: {
    title: "Add a loan",
    description: "A home, car or personal loan. With its rate and tenure you get the EMI, the full schedule, and a reminder before each EMI.",
    placeholder: "e.g. Home loan",
    submit: "Add loan",
    suggestions: [],
  },
};

/**
 * Edit an account's name, starting balance and start date (and delete it), or, with
 * `adding`, add a new bank account, cash, credit card or loan.
 */
export function AccountDialog({
  open,
  onOpenChange,
  editing,
  adding = "loan",
  loanTerms,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account to edit. Leave out to add one. */
  editing?: Account | null;
  /** What kind of account to add, when not editing. */
  adding?: AddableAccountType;
  /** Adding a loan: its details to start from (from the EMI calculator). */
  loanTerms?: LoanTerms;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open && <AccountForm key={editing?.id ?? `new-${adding}`} editing={editing ?? null} adding={adding} startTerms={loanTerms} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Adds a loan (or another account) right on the page, not in a pop-up: the Loans tab opens it under its tiles, the
 * way the EMI calculator opens. Cancel closes it.
 */
export function InlineAccountForm({ adding, loanTerms, onDone }: { adding: AddableAccountType; loanTerms?: LoanTerms; onDone: () => void }) {
  return <AccountForm editing={null} adding={adding} startTerms={loanTerms} onDone={onDone} inline />;
}

function AccountForm({
  editing,
  adding,
  startTerms,
  onDone,
  inline = false,
}: {
  editing: Account | null;
  adding: AddableAccountType;
  startTerms?: LoanTerms;
  onDone: () => void;
  /** On the page rather than in a dialog: plain headings (a dialog's title needs its dialog) and a Cancel button. */
  inline?: boolean;
}) {
  const f = useFinance();
  const type: AccountType = editing?.type ?? adding;
  const info = ACCOUNT_TYPE_INFO[type];
  const add = ADD_INFO[adding];
  const [name, setName] = useState(editing?.name ?? "");
  // Editing a bank, cash, card or loan: the box holds today's balance, as its label says (not the starting
  // balance, which your entries since are counted on top of). Saving a different figure moves the starting
  // balance by the difference, so today's balance comes out as entered.
  const { state } = useBalances();
  const todayMinor = editing && !editing.style && editing.type !== "investment" ? state.accounts.find((a) => a.account.id === editing.id)?.balanceMinor : undefined;
  const shownToday = todayMinor === undefined ? undefined : Math.max(0, todayMinor);
  const [balanceTouched, setBalanceTouched] = useState(false);
  const [balance, setBalance] = useState(
    editing ? minorToInputString(shownToday ?? editing.openingBalanceMinor) : "",
  );
  const [openedOn, setOpenedOn] = useState(editing?.openedOn ?? todayISO());
  const [limit, setLimit] = useState(editing?.creditLimitMinor ? minorToInputString(editing.creditLimitMinor) : "");
  const [style, setStyle] = useState<TradeStyle | "">(editing?.style ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Loans: the terms, and for a new one, whether the money just came in or it's been running a while.
  const [loan, setLoan] = useState(() => loanFieldValues(editing?.loanTerms ?? startTerms));
  const addingLoan = !editing && type === "loan";
  // What it's for: picked, or guessed from the name as you type it until you pick.
  const [kindPicked, setKindPicked] = useState<LoanKind | null>(editing?.loanKind ?? null);
  const loanKind = kindPicked ?? loanKindOf({ name });
  const [loanStart, setLoanStart] = useState<"new" | "running">("new");
  const moneyAccounts = f.book.accounts.filter((a) => a.type === "bank" || a.type === "cash");
  const [receivedIn, setReceivedIn] = useState(moneyAccounts.find((a) => a.type === "bank")?.id ?? moneyAccounts[0]?.id ?? "");
  const parsedLoan = type === "loan" ? parseLoanFields(loan) : { terms: null };
  const loanTerms = "terms" in parsedLoan ? parsedLoan.terms : null;
  // Already repaying: what the plan says is owed today, unless you typed your own figure.
  const plannedToday = loanTerms ? plannedOwedOn(loanTerms, todayISO()) : null;
  const entryCount = editing ? f.book.events.filter((e) => accountIdsUsedBy(e).includes(editing.id)).length : 0;
  const others = editing ? f.book.accounts.filter((a) => a.id !== editing.id && a.type !== "investment") : [];
  const [moveTo, setMoveTo] = useState(others.find((a) => a.type === editing?.type)?.id ?? others[0]?.id ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    if ("error" in parsedLoan) return setError(parsedLoan.error);
    if (addingLoan) return submitNewLoan();
    const entered = parseOpeningBalance(balance);
    if (!name.trim()) return setError("Give it a name.");
    if (entered === null) return setError("Enter a valid amount, or leave it blank for zero.");
    let openingBalanceMinor = entered;
    if (editing && todayMinor !== undefined) {
      // Left as it opened (a rename, say): nothing moves. A balance shown as 0 because it's below zero (cash spent
      // beyond the starting cash, a card paid beyond its recorded purchases) is corrected once you save it yourself.
      openingBalanceMinor = !balanceTouched ? editing.openingBalanceMinor : editing.openingBalanceMinor + (entered - todayMinor);
      if (openingBalanceMinor < 0) {
        return setError(
          `Your entries since ${formatDisplayDate(openedOn)} already add up to more than that. Pick a later "${editing.type === "credit_card" || editing.type === "loan" ? "Owed from" : "Entries from"}" date, or check the entries.`,
        );
      }
    }
    if (!openedOn) return setError("Pick a start date.");
    const creditLimitMinor = type === "credit_card" ? parseOpeningBalance(limit) : 0;
    if (creditLimitMinor === null) return setError("Enter a valid credit limit, or leave it blank.");

    const result = editing
      ? f.updateAccount(editing.id, {
          name,
          openingBalanceMinor,
          openedOn,
          ...(style ? { style } : {}),
          ...(type === "credit_card" ? { creditLimitMinor } : {}),
          ...(type === "loan" ? { loanTerms: loanTerms ?? undefined, loanKind } : {}),
        })
      : f.addAccount({ name, type, openingBalanceMinor, openedOn, creditLimitMinor });
    if (!result.ok) return setError(result.issues[0]?.message ?? "Couldn't save that.");
    onDone();
  }

  /**
   * A new loan. Just taken: the loan starts at nothing owed and a "Take a loan" entry brings the amount into your
   * account (so the bank balance and what you owe both go up). Already repaying: it starts at what's owed today.
   */
  function submitNewLoan() {
    if (!name.trim()) return setError("Give it a name.");
    if (loanStart === "new") {
      if (!loanTerms) return setError("Enter the loan's details: the amount borrowed, its rate and tenure.");
      if (!receivedIn) return setError("Choose the account the money came into.");
      if (!openedOn) return setError("Pick the day the money came in.");
      const added = f.addAccount({ name, type: "loan", openingBalanceMinor: 0, openedOn, loanTerms, loanKind });
      if (!added.ok) return setError(added.issues[0]?.message ?? "Couldn't save that.");
      const paid = f.addEvent({ type: "loan_taken", date: openedOn, fromAccountId: added.value.id, toAccountId: receivedIn, amountMinor: loanTerms.principalMinor });
      if (!paid.ok) return setError(paid.issues[0]?.message ?? "The loan was added, but the money coming in couldn't be recorded.");
      return onDone();
    }
    const owed = balance.trim() ? parseOpeningBalance(balance) : (plannedToday ?? 0);
    if (owed === null) return setError("Enter what you owe today as an amount.");
    const added = f.addAccount({ name, type: "loan", openingBalanceMinor: owed, openedOn: todayISO(), loanKind, ...(loanTerms ? { loanTerms } : {}) });
    if (!added.ok) return setError(added.issues[0]?.message ?? "Couldn't save that.");
    onDone();
  }

  function remove(choice?: { moveTo: string } | { withEntries: true }) {
    if (!editing) return;
    const r = f.deleteAccount(editing.id, choice);
    if (r.ok) onDone();
    else {
      setError(r.issues[0]?.message ?? "Couldn't delete that.");
      setConfirmDelete(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {inline ? (
        <DialogHeader>
          <h2 className="text-lg font-semibold">{add.title}</h2>
          <p className="text-sm text-muted-foreground">{add.description}</p>
        </DialogHeader>
      ) : (
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : add.title}</DialogTitle>
          <DialogDescription>{editing ? todayMinor !== undefined ? "Rename it, correct today's balance, or delete it." : "Rename it, set its starting balance, or delete it." : add.description}</DialogDescription>
        </DialogHeader>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="acc-name">Name</Label>
        <Input
          id="acc-name"
          // In a dialog the name is ready to type; on the page, focusing it would scroll the page and open the keyboard
          // under your finger as the form appears.
          autoFocus={!inline}
          autoComplete="off"
          maxLength={40}
          placeholder={editing ? "Name" : add.placeholder}
          list={!editing && add.suggestions.length > 0 ? "acc-name-suggestions" : undefined}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {!editing && add.suggestions.length > 0 && (
          <datalist id="acc-name-suggestions">
            {add.suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </div>

      {/* A stock can be moved to the other product (an intraday buy kept for delivery, say). */}
      {editing?.style && (
        <div className="grid gap-1.5">
          <Label>Product</Label>
          <StylePicker value={style} onChange={setStyle} />
        </div>
      )}

      {type === "loan" && (
        <div className="grid gap-1.5">
          <Label htmlFor="loan-kind">What&apos;s it for?</Label>
          <Select value={loanKind} onValueChange={(v) => setKindPicked(v as LoanKind)}>
            <SelectTrigger id="loan-kind" aria-label="What's the loan for?" data-testid="loan-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOAN_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {type === "loan" && <LoanFields value={loan} onChange={setLoan} />}

      {addingLoan && (
        <div className="grid gap-2" role="radiogroup" aria-label="Where are you with this loan?">
          {(
            [
              ["new", "I just took it", "The money came into my account"],
              ["running", "I'm already repaying it", "Start from what I owe today"],
            ] as const
          ).map(([v, title, hint]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={loanStart === v}
              onClick={() => setLoanStart(v)}
              className={cn("rounded-xl border px-3 py-2 text-left text-sm transition-colors", loanStart === v ? "border-primary bg-primary/5" : "hover:bg-muted")}
            >
              <span className="block font-medium">{title}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </button>
          ))}
          {loanStart === "new" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="loan-into">Came into</Label>
                <select id="loan-into" value={receivedIn} onChange={(e) => setReceivedIn(e.target.value)} className="h-11 rounded-lg border border-input bg-card px-2 text-base sm:h-10 sm:text-sm">
                  {moneyAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="loan-on">On</Label>
                <Input id="loan-on" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                {loanTerms ? `${formatRupees(loanTerms.principalMinor)} is added to that account, and to what you owe.` : "The amount borrowed is added to that account, and to what you owe."}
              </p>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="loan-owed">You owe today</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                <Input
                  id="loan-owed"
                  amount
                  autoComplete="off"
                  className="pl-7 tabular-nums"
                  placeholder={plannedToday !== null ? minorToInputString(plannedToday) : "0"}
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {plannedToday !== null ? "Left blank, it's what the schedule says after the EMIs due so far. Your bank's app shows the exact figure." : "The outstanding amount, as your bank shows it."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* A stock's shares come from its orders, so it has no starting balance to set. A new loan has its own choice above. */}
      <div className={cn("grid grid-cols-2 gap-4", (editing?.style || addingLoan) && "hidden")}>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="acc-balance">{info.balanceLabel}</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
            <Input
              id="acc-balance"
              amount
              autoComplete="off"
              placeholder="0"
              className="pl-7 tabular-nums"
              value={balance}
              onChange={(e) => {
                setBalance(e.target.value);
                setBalanceTouched(true);
              }}
            />
          </div>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="acc-date">{todayMinor !== undefined ? (type === "credit_card" || type === "loan" ? "Owed from" : "Entries from") : "As of"}</Label>
          <Input id="acc-date" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
        </div>
      </div>

      {type === "credit_card" && (
        <div className="grid gap-1.5">
          <Label htmlFor="acc-limit">Credit limit</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
            <Input
              id="acc-limit"
              amount
              autoComplete="off"
              placeholder="60,000"
              className="pl-7 tabular-nums"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">Leave it blank for ₹60,000. Home shows what you can still spend: the limit, less the unpaid bill and spending since the statement.</p>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <DialogFooter className="items-center">
        {editing &&
          (confirmDelete && entryCount > 0 ? (
            <div className="grid w-full gap-3 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm" data-testid="delete-account-choice">
              <p className="text-red-900">
                <strong>{editing.name}</strong> has {entryCount} {entryCount === 1 ? "entry" : "entries"}. What should happen to {entryCount === 1 ? "it" : "them"}?
              </p>
              {others.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span>Move to</span>
                  <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="h-10 rounded-md border bg-card px-2 text-base sm:h-8 sm:text-sm" aria-label="Move entries to">
                    {others.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <Button type="button" size="sm" onClick={() => remove({ moveTo })} disabled={!moveTo}>
                    Move and delete account
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="destructive" onClick={() => remove({ withEntries: true })}>
                  Delete account and its {entryCount} {entryCount === 1 ? "entry" : "entries"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : confirmDelete ? (
            <>
              <span className="mr-auto text-sm text-red-800">Delete this account?</span>
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                No
              </Button>
              <Button type="button" variant="destructive" onClick={() => remove()}>
                Delete
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ))}
        {inline && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        {!confirmDelete && <Button type="submit">{editing ? "Save" : add.submit}</Button>}
      </DialogFooter>
    </form>
  );
}
