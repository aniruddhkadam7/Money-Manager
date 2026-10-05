"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayISO } from "@/lib/domain/dates";
import { accountIdsUsedBy } from "@/lib/finance/book-ops";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import type { Account, AccountType } from "@/lib/finance/types";
import { useFinance } from "../finance-provider";
import { type PictureName } from "../picture-icon";

export const ACCOUNT_TYPE_INFO: Record<AccountType, { label: string; picture: PictureName; balanceLabel: string }> = {
  bank: { label: "Bank / UPI", picture: "bank", balanceLabel: "Balance today" },
  cash: { label: "Cash / wallet", picture: "cash", balanceLabel: "Balance today" },
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

/**
 * Edit an account's name, starting balance and start date, or (with no `editing`)
 * add a loan. Everyday accounts (Cash, UPI, cards...) are a fixed set that already
 * exists; there is deliberately no way to add another bank account.
 */
export function AccountDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account to edit. Leave out to add a loan. */
  editing?: Account | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open && <AccountForm key={editing?.id ?? "new-loan"} editing={editing ?? null} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({ editing, onDone }: { editing: Account | null; onDone: () => void }) {
  const f = useFinance();
  const type: AccountType = editing?.type ?? "loan";
  const info = ACCOUNT_TYPE_INFO[type];
  const [name, setName] = useState(editing?.name ?? "");
  const [balance, setBalance] = useState(editing ? minorToInputString(editing.openingBalanceMinor) : "");
  const [openedOn, setOpenedOn] = useState(editing?.openedOn ?? todayISO());
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const entryCount = editing ? f.book.events.filter((e) => accountIdsUsedBy(e).includes(editing.id)).length : 0;
  const others = editing ? f.book.accounts.filter((a) => a.id !== editing.id && a.type !== "investment") : [];
  const [moveTo, setMoveTo] = useState(others.find((a) => a.type === editing?.type)?.id ?? others[0]?.id ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    const openingBalanceMinor = parseOpeningBalance(balance);
    if (!name.trim()) return setError("Give it a name.");
    if (openingBalanceMinor === null) return setError("Enter a valid amount, or leave it blank for zero.");
    if (!openedOn) return setError("Pick a start date.");

    const result = editing
      ? f.updateAccount(editing.id, { name, openingBalanceMinor, openedOn })
      : f.addAccount({ name, type, openingBalanceMinor, openedOn });
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
        <DialogTitle>{editing ? `Edit ${editing.name}` : "Add a loan"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "Change the name, or set what it held when you started tracking."
            : "Record a loan you're repaying, such as a home or car loan. Pay it down with a Transfer."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="acc-name">Name</Label>
        <Input
          id="acc-name"
          autoFocus
          autoComplete="off"
          maxLength={40}
          placeholder={editing ? "Name" : "e.g. Home loan"}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
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
              onChange={(e) => setBalance(e.target.value)}
            />
          </div>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="acc-date">As of</Label>
          <Input id="acc-date" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
        </div>
      </div>

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
                  <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="h-8 rounded-md border bg-card px-2" aria-label="Move entries to">
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
        {!confirmDelete && <Button type="submit">{editing ? "Save" : "Add loan"}</Button>}
      </DialogFooter>
    </form>
  );
}
