"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDisplayDate, todayISO } from "@/lib/domain/dates";
import { BANK_BRANDS } from "@/lib/finance/bank-logos";
import { accountIdsUsedBy } from "@/lib/finance/book-ops";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import type { Account, AccountType, TradeStyle } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";
import { useBalances } from "../statements/use-statement-checks";
import { StylePicker } from "../investments/style-picker";
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
    description: "A home or car loan you're repaying. Pay it with a Transfer.",
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account to edit. Leave out to add one. */
  editing?: Account | null;
  /** What kind of account to add, when not editing. */
  adding?: AddableAccountType;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open && <AccountForm key={editing?.id ?? `new-${adding}`} editing={editing ?? null} adding={adding} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({ editing, adding, onDone }: { editing: Account | null; adding: AddableAccountType; onDone: () => void }) {
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
  const entryCount = editing ? f.book.events.filter((e) => accountIdsUsedBy(e).includes(editing.id)).length : 0;
  const others = editing ? f.book.accounts.filter((a) => a.id !== editing.id && a.type !== "investment") : [];
  const [moveTo, setMoveTo] = useState(others.find((a) => a.type === editing?.type)?.id ?? others[0]?.id ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
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
      ? f.updateAccount(editing.id, { name, openingBalanceMinor, openedOn, ...(style ? { style } : {}), ...(type === "credit_card" ? { creditLimitMinor } : {}) })
      : f.addAccount({ name, type, openingBalanceMinor, openedOn, creditLimitMinor });
    if (!result.ok) return setError(result.issues[0]?.message ?? "Couldn't save that.");
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
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${editing.name}` : add.title}</DialogTitle>
        <DialogDescription>{editing ? todayMinor !== undefined ? "Rename it, correct today's balance, or delete it." : "Rename it, set its starting balance, or delete it." : add.description}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="acc-name">Name</Label>
        <Input
          id="acc-name"
          autoFocus
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

      {/* A stock's shares come from its orders, so it has no starting balance to set. */}
      <div className={cn("grid grid-cols-2 gap-4", editing?.style && "hidden")}>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="acc-balance">{info.balanceLabel}</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
            <Input
              id="acc-balance"
              inputMode="decimal"
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
              inputMode="decimal"
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
        {!confirmDelete && <Button type="submit">{editing ? "Save" : add.submit}</Button>}
      </DialogFooter>
    </form>
  );
}
