"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayISO } from "@/lib/domain/dates";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import { formatRupees } from "@/lib/finance/describe";
import type { AccountType, EventDraft, EventType, FinancialEvent } from "@/lib/finance/types";
import { CategoryIcon } from "../category-icon";
import { useFinance } from "../finance-provider";
import { PictureIcon, type PictureName } from "../picture-icon";
import { EVENT_OPTIONS, eventOption, FORM_SPEC, type FieldKey } from "./event-meta";

export interface FormPreset {
  person?: string;
  holdingId?: string;
}

interface Values {
  amount: string;
  description: string;
  categoryId: string;
  accountId: string;
  toAccountId: string;
  person: string;
  holdingName: string;
  holdingId: string;
  soldValue: string;
  date: string;
  shares: { person: string; amount: string }[];
}

const ACCOUNT_PICTURE: Record<AccountType, PictureName> = {
  bank: "bank",
  cash: "cash",
  credit_card: "credit-card",
  loan: "loan",
  investment: "invest",
};

type Errors = Partial<Record<FieldKey | "form", string>>;

/** The main account an entry used (what "Paid from" / "Received in" showed). */
function primaryAccountId(e: FinancialEvent): string | undefined {
  switch (e.type) {
    case "transfer":
    case "invest":
      return e.fromAccountId;
    case "sell_investment":
      return e.toAccountId;
    case "update_valuation":
      return undefined;
    default:
      return e.accountId;
  }
}


export function EventForm({
  type,
  editing,
  template,
  preset,
  onBack,
  onChangeType,
  onSaved,
}: {
  type: EventType;
  editing?: FinancialEvent;
  /** A new entry that starts as a copy of this one (dated today). */
  template?: FinancialEvent;
  preset?: FormPreset;
  onBack?: () => void;
  /** When editing: switch this entry to another kind (borrowed -> lent, expense -> split...). */
  onChangeType?: (type: EventType) => void;
  onSaved: (eventId: string, wasEdit: boolean) => void;
}) {
  const f = useFinance();
  const spec = FORM_SPEC[type];
  const option = eventOption(type);
  const personName = (id: string) => f.book.people.find((p) => p.id === id)?.name ?? "";
  const accountName = (id: string) => f.book.accounts.find((a) => a.id === id)?.name ?? "";

  const accountsFor = (types: AccountType[]) => f.book.accounts.filter((a) => types.includes(a.type));
  const mainAccounts = accountsFor(spec.accountTypes);
  const toAccounts = accountsFor(["bank", "cash", "credit_card", "loan"]);
  const investments = accountsFor(["investment"]);

  const [values, setValues] = useState<Values>(() => initialValues());
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  function initialValues(): Values {
    const v = carriedValues();
    // Carried over from another kind of entry: keep the account only if this kind can use it, and ask for the category again.
    const e = editing ?? template;
    if (e && e.type !== type) {
      if (!mainAccounts.some((a) => a.id === v.accountId)) v.accountId = mainAccounts[0]?.id ?? "";
      v.categoryId = "";
    }
    return v;
  }

  function carriedValues(): Values {
    const e = editing ?? template;
    // Preselect what this person usually uses: the account from their latest entry of this kind, else any latest entry.
    const recent = [...f.book.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const usable = (e: FinancialEvent) => {
      const id = primaryAccountId(e);
      return id && mainAccounts.some((a) => a.id === id) ? id : undefined;
    };
    const habitual =
      recent.filter((e) => e.type === type).map(usable).find(Boolean) ?? recent.map(usable).find(Boolean) ?? mainAccounts[0]?.id ?? "";

    const base: Values = {
      amount: "",
      description: "",
      categoryId: "",
      accountId: habitual,
      toAccountId: "",
      person: preset?.person ?? "",
      holdingName: "",
      holdingId: preset?.holdingId ?? investments[0]?.id ?? "",
      soldValue: "",
      date: todayISO(),
      shares: [{ person: "", amount: "" }],
    };
    if (!e) return base;
    base.date = editing ? e.date : todayISO();
    base.description = e.description ?? "";
    switch (e.type) {
      case "expense":
      case "income":
        return { ...base, amount: minorToInputString(e.amountMinor), categoryId: e.categoryId, accountId: e.accountId };
      case "transfer":
        return { ...base, amount: minorToInputString(e.amountMinor), accountId: e.fromAccountId, toAccountId: e.toAccountId };
      case "lend":
      case "borrow":
      case "repayment_received":
      case "repayment_made":
        return { ...base, amount: minorToInputString(e.amountMinor), accountId: e.accountId, person: personName(e.personId) };
      case "split_expense":
        return {
          ...base,
          amount: minorToInputString(e.totalMinor),
          categoryId: e.categoryId,
          accountId: e.accountId,
          shares: e.shares.map((s) => ({ person: personName(s.personId), amount: minorToInputString(s.amountMinor) })),
        };
      case "reimbursable_expense":
        return {
          ...base,
          amount: minorToInputString(e.amountMinor),
          categoryId: e.categoryId,
          accountId: e.accountId,
          person: personName(e.personId),
        };
      case "invest":
        return { ...base, amount: minorToInputString(e.amountMinor), accountId: e.fromAccountId, holdingName: accountName(e.holdingId) };
      case "sell_investment":
        return {
          ...base,
          amount: minorToInputString(e.proceedsMinor),
          accountId: e.toAccountId,
          holdingId: e.holdingId,
          soldValue: e.soldValueMinor === undefined ? "" : minorToInputString(e.soldValueMinor),
        };
      case "update_valuation":
        return { ...base, amount: minorToInputString(e.valueMinor), holdingId: e.holdingId };
    }
  }

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  const categories = spec.categoryKind === "income" ? f.incomeCategories : f.expenseCategories;
  const amountMinor = parseAmountToMinor(values.amount);

  /** For repayments: how much does this person owe / am I owed? */
  const personHint = useMemo(() => {
    if (type !== "repayment_received" && type !== "repayment_made") return null;
    const match = f.state.people.find((p) => p.person.name.toLowerCase() === values.person.trim().toLowerCase());
    if (!match) return null;
    return type === "repayment_received"
      ? `${match.person.name} owes you ${formatRupees(match.owedToMe.outstandingMinor)}`
      : `You owe ${match.person.name} ${formatRupees(match.iOwe.outstandingMinor)}`;
  }, [type, values.person, f.state.people]);

  const othersTotal = values.shares.reduce((t, s) => t + (parseAmountToMinor(s.amount) ?? 0), 0);
  const yourShare = amountMinor === null ? null : amountMinor - othersTotal;

  async function handleAddCategory() {
    const name = newCategory.trim();
    if (!name) return;
    const created = await f.addCategory(name);
    set("categoryId", created.id);
    setNewCategory("");
    setAddingCategory(false);
  }

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const next: Errors = {};
    const has = (k: FieldKey) => spec.fields.includes(k);

    if (has("amount") && amountMinor === null) next.amount = "Enter an amount, e.g. 850 or 99.50";
    if (has("description") && spec.descriptionRequired && !values.description.trim()) next.description = "Add a short description";
    if (has("category") && !values.categoryId) next.category = "Pick a category";
    if (has("account") && !values.accountId) next.account = "Choose an account";
    if (has("toAccount") && !values.toAccountId) next.toAccount = "Choose an account";
    if (has("person") && !values.person.trim()) next.person = "Enter a name";
    if (has("holdingName") && !values.holdingName.trim()) next.holdingName = "Enter what you invested in";
    if (has("holdingSelect") && !values.holdingId) next.holdingSelect = "Choose an investment";
    if (has("date") && !values.date) next.date = "Pick a date";
    if (has("soldValue") && values.soldValue.trim() && parseAmountToMinor(values.soldValue) === null) {
      next.soldValue = "Enter an amount, or leave blank to sell everything";
    }
    if (has("shares")) {
      const rows = values.shares.filter((s) => s.person.trim() || s.amount.trim());
      if (rows.length === 0 || rows.some((s) => !s.person.trim() || parseAmountToMinor(s.amount) === null)) {
        next.shares = "Add each person and the amount they owe you";
      } else if (amountMinor !== null && othersTotal > amountMinor) {
        next.shares = "Others' shares add up to more than the bill";
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || (has("amount") && amountMinor === null)) return;

    setSaving(true);
    const draft = buildDraft(amountMinor ?? 0);
    if (!draft) {
      setErrors({ form: "Something is missing. Please check the form." });
      setSaving(false);
      return;
    }

    const result = editing ? f.updateEvent(editing.id, draft) : f.addEvent(draft);
    if (!result.ok) {
      setErrors({ form: result.issues[0]?.message ?? "That can't be saved." });
      setSaving(false);
      return;
    }
    onSaved(result.value, !!editing);
  }

  function buildDraft(amount: number): EventDraft | null {
    const description = values.description.trim() || undefined;
    const date = values.date;
    const personId = () => f.resolvePerson(values.person);

    switch (type) {
      case "expense":
        return { type, date, description, accountId: values.accountId, amountMinor: amount, categoryId: values.categoryId };
      case "income":
        return { type, date, description, accountId: values.accountId, amountMinor: amount, categoryId: values.categoryId };
      case "transfer":
        return { type, date, fromAccountId: values.accountId, toAccountId: values.toAccountId, amountMinor: amount };
      case "lend":
      case "borrow": {
        const id = personId();
        return id ? { type, date, personId: id, accountId: values.accountId, amountMinor: amount } : null;
      }
      case "repayment_received":
      case "repayment_made": {
        // The original loan may be from before these records began, or in cash: don't insist it was entered.
        const id = personId();
        return id ? { type, date, personId: id, accountId: values.accountId, amountMinor: amount, predatesRecords: true } : null;
      }
      case "split_expense": {
        const shares: { personId: string; amountMinor: number }[] = [];
        for (const s of values.shares.filter((r) => r.person.trim())) {
          const id = f.resolvePerson(s.person);
          const share = parseAmountToMinor(s.amount);
          if (!id || share === null) return null;
          shares.push({ personId: id, amountMinor: share });
        }
        return { type, date, description, accountId: values.accountId, totalMinor: amount, categoryId: values.categoryId, shares };
      }
      case "reimbursable_expense": {
        const id = personId();
        return id
          ? { type, date, description, accountId: values.accountId, amountMinor: amount, categoryId: values.categoryId, personId: id }
          : null;
      }
      case "invest": {
        const holdingId = f.resolveInvestment(values.holdingName);
        return holdingId ? { type, date, fromAccountId: values.accountId, holdingId, amountMinor: amount } : null;
      }
      case "sell_investment": {
        const sold = values.soldValue.trim() ? parseAmountToMinor(values.soldValue) : null;
        return {
          type,
          date,
          holdingId: values.holdingId,
          toAccountId: values.accountId,
          proceedsMinor: amount,
          ...(sold !== null ? { soldValueMinor: sold } : {}),
        };
      }
      case "update_valuation":
        return { type, date, holdingId: values.holdingId, valueMinor: amount };
    }
  }

  /* ---------------- field renderers ---------------- */

  const label = (key: FieldKey, fallback: string) => spec.labels[key] ?? fallback;

  const field = (key: FieldKey): ReactNode => {
    switch (key) {
      case "amount":
        return (
          <Field key={key} id="amount" label={label("amount", "Amount")} error={errors.amount}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
              <Input
                id="amount"
                inputMode="decimal"
                autoComplete="off"
                autoFocus={!editing && !preset}
                placeholder="0"
                className="pl-7 text-base font-medium tabular-nums"
                value={values.amount}
                onChange={(e) => set("amount", e.target.value)}
                aria-invalid={!!errors.amount}
              />
            </div>
            {type === "update_valuation" && values.holdingId && (
              <ValueHint holdingId={values.holdingId} />
            )}
          </Field>
        );

      case "description":
        return (
          <Field key={key} id="description" label={label("description", "Description")} error={errors.description}>
            <Input
              id="description"
              autoComplete="off"
              maxLength={80}
              placeholder={type === "income" ? "e.g. Acme Pvt Ltd" : "e.g. Swiggy"}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              aria-invalid={!!errors.description}
            />
          </Field>
        );

      case "category":
        return (
          <Field key={key} id="category" label="Category" error={errors.category}>
            <Select value={values.categoryId} onValueChange={(v) => set("categoryId", v)}>
              <SelectTrigger id="category" aria-invalid={!!errors.category}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      <CategoryIcon category={c} />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {spec.categoryKind === "expense" &&
              (addingCategory ? (
                <div className="mt-1 flex gap-2">
                  <Input
                    autoFocus
                    placeholder="New category name"
                    maxLength={30}
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAddCategory();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={() => void handleAddCategory()}>
                    Add
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingCategory(true)}
                  className="inline-flex items-center gap-1 justify-self-start pt-1 text-sm font-medium text-primary hover:underline"
                >
                  <Plus className="size-3.5" /> New category
                </button>
              ))}
          </Field>
        );

      case "account":
        return (
          <AccountField
            key={key}
            id="account"
            label={label("account", "Account")}
            value={values.accountId}
            onChange={(v) => set("accountId", v)}
            accounts={mainAccounts}
            error={errors.account}
          />
        );

      case "toAccount":
        return (
          <AccountField
            key={key}
            id="toAccount"
            label={label("toAccount", "To")}
            value={values.toAccountId}
            onChange={(v) => set("toAccountId", v)}
            accounts={toAccounts.filter((a) => a.id !== values.accountId)}
            error={errors.toAccount}
          />
        );

      case "person":
        return (
          <Field key={key} id="person" label={label("person", "Who?")} error={errors.person}>
            <Input
              id="person"
              list="people-list"
              autoComplete="off"
              autoFocus={!!preset?.person ? false : !editing}
              maxLength={40}
              placeholder="e.g. Rahul"
              value={values.person}
              onChange={(e) => set("person", e.target.value)}
              aria-invalid={!!errors.person}
            />
            <datalist id="people-list">
              {f.book.people.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            {personHint && <p className="text-xs text-muted-foreground">{personHint}</p>}
          </Field>
        );

      case "holdingName":
        return (
          <Field key={key} id="holdingName" label={label("holdingName", "Invest in")} error={errors.holdingName}>
            <Input
              id="holdingName"
              list="holdings-list"
              autoComplete="off"
              maxLength={50}
              placeholder="e.g. Nifty 50 index fund"
              value={values.holdingName}
              onChange={(e) => set("holdingName", e.target.value)}
              aria-invalid={!!errors.holdingName}
            />
            <datalist id="holdings-list">
              {investments.map((a) => (
                <option key={a.id} value={a.name} />
              ))}
            </datalist>
          </Field>
        );

      case "holdingSelect":
        return investments.length === 0 ? (
          <p key={key} className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
            You haven&apos;t invested in anything yet. Record an investment first.
          </p>
        ) : (
          <Field key={key} id="holding" label={label("holdingSelect", "Investment")} error={errors.holdingSelect}>
            <Select value={values.holdingId} onValueChange={(v) => set("holdingId", v)}>
              <SelectTrigger id="holding">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {investments.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="flex items-center gap-2">
                      <PictureIcon name="invest" />
                      {a.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        );

      case "soldValue":
        return (
          <Field key={key} id="soldValue" label="Part sold (optional)" error={errors.soldValue}>
            <Input
              id="soldValue"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Leave blank to sell everything"
              value={values.soldValue}
              onChange={(e) => set("soldValue", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              If you sold only part, enter that part&apos;s current value.
            </p>
          </Field>
        );

      case "shares":
        return (
          <div key={key} className="grid gap-2">
            <Label>Who owes you a share?</Label>
            {values.shares.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  list="people-list"
                  autoComplete="off"
                  placeholder="Name"
                  maxLength={40}
                  value={row.person}
                  onChange={(e) =>
                    set("shares", values.shares.map((r, j) => (j === i ? { ...r, person: e.target.value } : r)))
                  }
                />
                <div className="relative w-32 shrink-0">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    className="pl-7 tabular-nums"
                    value={row.amount}
                    onChange={(e) =>
                      set("shares", values.shares.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                    }
                  />
                </div>
                {values.shares.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove"
                    onClick={() => set("shares", values.shares.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                )}
              </div>
            ))}
            <datalist id="people-list">
              {f.book.people.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => set("shares", [...values.shares, { person: "", amount: "" }])}
              className="inline-flex items-center gap-1 justify-self-start text-sm font-medium text-primary hover:underline"
            >
              <Plus className="size-3.5" /> Add another person
            </button>
            {yourShare !== null && (
              <p className="text-sm text-muted-foreground">
                Your own share: <span className="font-medium text-foreground">{formatRupees(Math.max(yourShare, 0))}</span>
              </p>
            )}
            {errors.shares && <p className="text-xs text-destructive">{errors.shares}</p>}
          </div>
        );

      case "date":
        return (
          <Field key={key} id="date" label="Date" error={errors.date}>
            <Input id="date" type="date" value={values.date} onChange={(e) => set("date", e.target.value)} aria-invalid={!!errors.date} />
          </Field>
        );
    }
  };

  // Put short fields (account/date, etc.) side by side where it reads naturally.
  const noAccountsForType = spec.fields.includes("account") && mainAccounts.length === 0;

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <div className="flex items-center gap-3">
          {onBack && !editing && (
            <Button type="button" variant="ghost" size="icon" aria-label="Back" onClick={onBack} className="-ml-2">
              <ArrowLeft />
            </Button>
          )}
          <PictureIcon name={option.picture} className="size-8" />
          <div>
            <DialogTitle>{editing ? `Edit: ${option.label.toLowerCase()}` : option.label}</DialogTitle>
            <DialogDescription>{template && !editing ? "Copied from an earlier entry. Change anything, then save." : option.hint}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {editing && onChangeType && (
        <div className="grid gap-1.5" data-testid="change-type">
          <Label>What kind of entry is this?</Label>
          <Select value={type} onValueChange={(v) => v !== type && onChangeType(v as EventType)}>
            <SelectTrigger aria-label="Kind of entry">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_OPTIONS.filter((o) => o.type !== "update_valuation" || type === "update_valuation").map((o) => (
                <SelectItem key={o.type} value={o.type}>
                  {o.label} — {o.hint}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editing.type !== type && <p className="text-xs text-muted-foreground">Changing this from “{eventOption(editing.type).label}”. Fill in what the new kind needs, then save.</p>}
        </div>
      )}

      {noAccountsForType ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          None of your accounts can be used for this. Restore the standard accounts (Cash, UPI, cards…) on the Money page.
        </p>
      ) : (
        spec.fields.map((k) => field(k))
      )}

      {errors.form && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{errors.form}</p>}

      <DialogFooter>
        <Button type="submit" disabled={saving || noAccountsForType}>
          {editing ? "Save changes" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ValueHint({ holdingId }: { holdingId: string }) {
  const { state } = useFinance();
  const h = state.investments.holdings.find((x) => x.account.id === holdingId);
  if (!h) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Currently {formatRupees(h.valueMinor)} · you put in {formatRupees(h.costBasisMinor)}
    </p>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function AccountField({
  id,
  label,
  value,
  onChange,
  accounts,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  accounts: { id: string; name: string; type: AccountType }[];
  error?: string;
}) {
  return (
    <Field id={id} label={label} error={error}>
      {/* Ignore the empty value Radix's hidden native select can briefly report. */}
      <Select value={value} onValueChange={(v) => (v ? onChange(v) : undefined)}>
        <SelectTrigger id={id} aria-invalid={!!error}>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              <span className="flex items-center gap-2">
                <PictureIcon name={ACCOUNT_PICTURE[a.type]} />
                {a.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
