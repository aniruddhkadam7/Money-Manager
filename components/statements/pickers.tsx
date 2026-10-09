"use client";

import { useState, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AccountType } from "@/lib/finance/types";
import type { StatementEventType } from "@/lib/statements/types";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";

const NEW = "__new__";

/** The kind of account a statement line moves money to or from, by what the line is. */
export function counterAccountType(type: StatementEventType): AccountType | "money" {
  if (type === "CREDIT_CARD_PAYMENT") return "credit_card";
  if (type === "LOAN_REPAYMENT") return "loan";
  return "money";
}

const NOUN: Record<AccountType | "money", { one: string; placeholder: string }> = {
  credit_card: { one: "card", placeholder: "Card name, e.g. HDFC Regalia" },
  loan: { one: "loan", placeholder: "Loan name, e.g. Car loan" },
  money: { one: "account", placeholder: "Account name" },
  bank: { one: "account", placeholder: "Account name" },
  cash: { one: "account", placeholder: "Account name" },
  investment: { one: "investment", placeholder: "Investment name" },
};

/** Type a name and add it, in place of a dropdown. */
function CreateInline({ placeholder, onCreate, onCancel, className }: { placeholder: string; onCreate: (name: string) => string | null; onCancel: () => void; className?: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!name.trim()) return;
    const problem = onCreate(name.trim());
    if (problem) setError(problem);
  };
  return (
    <div className={cn("grid gap-1", className)}>
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={name}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-8 min-w-0 flex-1"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") onCancel();
          }}
        />
        <Button type="button" size="icon" className="size-8 shrink-0" aria-label="Add" disabled={!name.trim()} onClick={submit}>
          <Check />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Cancel" onClick={onCancel}>
          <X />
        </Button>
      </div>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

function NewItem({ children }: { children: ReactNode }) {
  return (
    <>
      <SelectSeparator />
      <SelectItem value={NEW}>
        <span className="flex items-center gap-1.5 font-medium text-primary">
          <Plus className="size-3.5" /> {children}
        </span>
      </SelectItem>
    </>
  );
}

/**
 * Which card, loan or account a line moves money to or from, with "+ New loan…" / "+ New card…" so a
 * missing one can be added right here instead of leaving the review. Bank and cash accounts are the
 * app's fixed set (see AccountDialog), so there's no "new" for those.
 */
export function CounterAccountSelect({
  type,
  excludeId,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  type: StatementEventType;
  /** The statement's own account, which can't be the other side. */
  excludeId?: string;
  value: string;
  onChange: (accountId: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const { book, addAccount } = useFinance();
  const kind = counterAccountType(type);
  const [creating, setCreating] = useState(false);
  const accounts = book.accounts.filter(
    (a) => a.id !== excludeId && (kind === "money" ? a.type === "bank" || a.type === "cash" : a.type === kind),
  );
  const noun = NOUN[kind];

  if (creating) {
    return (
      <CreateInline
        className={className}
        placeholder={noun.placeholder}
        onCancel={() => setCreating(false)}
        onCreate={(name) => {
          // The amount still owed (or held) can be set later from the Money page.
          if (kind === "money") return null;
          const r = addAccount({ name, type: kind, openingBalanceMinor: 0, openedOn: "2000-01-01" });
          if (!r.ok) return r.issues[0]?.message ?? "Couldn't add it.";
          onChange(r.value.id);
          setCreating(false);
          return null;
        }}
      />
    );
  }

  return (
    <Select value={value} onValueChange={(v) => (v === NEW ? setCreating(true) : onChange(v))}>
      <SelectTrigger className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={accounts.length || kind === "money" ? "Choose" : `Add a ${noun.one}`} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
        {kind !== "money" && <NewItem>New {noun.one}…</NewItem>}
      </SelectContent>
    </Select>
  );
}

/** A category by name, with "+ New category…" for spending (income keeps its fixed list). */
export function CategorySelect({
  names,
  value,
  onChange,
  allowNew,
  className,
  ariaLabel,
  placeholder,
}: {
  names: string[];
  value: string;
  onChange: (name: string) => void;
  allowNew: boolean;
  className?: string;
  ariaLabel: string;
  placeholder?: string;
}) {
  const { addCategory } = useFinance();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  if (creating) {
    return (
      <CreateInline
        className={className}
        placeholder="New category name"
        onCancel={() => setCreating(false)}
        onCreate={(name) => {
          const existing = names.find((n) => n.toLowerCase() === name.toLowerCase());
          if (existing) {
            onChange(existing);
            setCreating(false);
            return null;
          }
          if (busy) return null;
          setBusy(true);
          addCategory(name)
            .then((c) => {
              onChange(c.name);
              setCreating(false);
            })
            .finally(() => setBusy(false));
          return null;
        }}
      />
    );
  }

  return (
    <Select value={value} onValueChange={(v) => (v === NEW ? setCreating(true) : onChange(v))}>
      <SelectTrigger className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {names.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
        {allowNew && <NewItem>New category…</NewItem>}
      </SelectContent>
    </Select>
  );
}
