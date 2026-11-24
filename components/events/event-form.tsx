"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { categoryLabel } from "@/lib/domain/categories";
import { todayISO } from "@/lib/domain/dates";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import { ensurePerson } from "@/lib/finance/book-ops";
import { formatRupees } from "@/lib/finance/describe";
import { ledgerIds } from "@/lib/finance/engine";
import type { AccountType, EventDraft, EventType, FinancialEvent } from "@/lib/finance/types";
import { accountPicture, BankMark } from "../account-logo";
import { CategoryIcon } from "../category-icon";
import { FileTypeIcon } from "../statements/file-type-icon";
import { useFinance } from "../finance-provider";
import type { TradePreset } from "../investments/trade-form";
import { PictureIcon } from "../picture-icon";
import { EVENT_OPTIONS, eventOption, FORM_SPEC, type FieldKey } from "./event-meta";
import { NoteField, noteOf } from "./note-field";
import { cn } from "@/lib/utils";
import { useStatements } from "../statements/statements-provider";
import { DebtTermsFields, debtTermsValues, parseDebtTerms, type DebtTermsValues } from "./debt-terms";
import { personDebts, termsWords } from "@/lib/finance/debts";
import { namesOf } from "@/lib/finance/person-summary";
import { formatDisplayDate } from "@/lib/domain/dates";
import { loanProgress } from "@/lib/finance/loan";
import { billFor, currentBills, setBillDue, updateBills, useBills } from "@/lib/finance/bills";

export interface FormPreset {
  person?: string;
  holdingId?: string;
  /** A stock order: side, stock and quantity already chosen (Exit on a position, say). */
  trade?: TradePreset;
  /** A new entry's date (say, the day picked on the calendar) instead of today. */
  date?: string;
  /** Pay EMI: which loan (from the loan's Pay EMI button). */
  loanId?: string;
  /** Borrow / owe: start as money borrowed or as a service on credit, and with the terms box open. */
  borrowFor?: "money" | "service" | "held";
  /** Borrow / owe: open the repayment terms (a short-term loan with a date, instalments, interest). */
  withTerms?: boolean;
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
  /** Take a loan: the loan's name (an existing loan, or a new one to add). */
  loanName: string;
  /** Pay EMI: which loan. */
  loanId: string;
  /** Pay EMI: the interest part. */
  interest: string;
  date: string;
  shares: { person: string; amount: string }[];
  /** Split expense: the bill is shared equally between you and everyone named. */
  splitEqually: boolean;
  /** Lend / borrow: owed from before records began, so no money moves in an account now. */
  beforeTracking: boolean;
  /** The money moved, but no bank statement will show it: counted on top of the bank's balance. */
  offStatement: boolean;
  /** Your reason for the entry, if you want to say (saved as its `note`). */
  note: string;
  /** A bill payment: when the bill is due again, or the plan expires (kept on the bill in Bills, see EventBase.billId). */
  billDue: string;
  /** Borrow: money that came in, or a service or goods to pay for later. */
  borrowFor: "money" | "service" | "held";
  /** Borrow: how it's to be paid back (all optional). */
  debtTerms: DebtTermsValues;
  /** Paid someone back: the interest part, if any. */
  repayInterest: string;
  /** An expense paid on someone else's behalf: they'll pay it back (saved as "Paid for someone"). */
  forSomeone: boolean;
}

/** Kinds of entry that can pay a bill, and the categories where the bill date is offered without asking. */
const BILL_TYPES = new Set<EventType>(["expense", "split_expense", "reimbursable_expense"]);
const BILL_CATEGORIES = new Set(["bills", "subscriptions"]);

type Errors = Partial<Record<FieldKey | "form", string>>;


/** The main account an entry used (what "Paid from" / "Received in" showed). */
function primaryAccountId(e: FinancialEvent): string | undefined {
  switch (e.type) {
    case "transfer":
    case "invest":
    case "emi_payment":
      return e.fromAccountId;
    case "sell_investment":
    case "loan_taken":
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
  // An entry from a bank statement: which way its line went (credit in, debit out), to offer only kinds that match.
  const statementsCtx = useStatements();
  const lineDirection = editing?.sources
    ?.map((src) => statementsCtx.rowsOf(src.importId).find((r) => r.id === src.rowId)?.direction)
    .find((d): d is "credit" | "debit" => !!d);
  // Bills (in the profile menu), live: a date changed there shows here straight away.
  const billsData = useBills();
  const spec = FORM_SPEC[type];
  const option = eventOption(type);
  const personName = (id: string) => f.book.people.find((p) => p.id === id)?.name ?? "";
  const accountName = (id: string) => f.book.accounts.find((a) => a.id === id)?.name ?? "";
  // Names already used in your records (latest spelling wins), offered while typing for consistency.
  const knownDescriptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of [...f.book.events].sort((a, b) => a.date.localeCompare(b.date))) {
      const d = (e.description ?? "").trim();
      if (d) seen.set(d.toLowerCase(), d);
    }
    return [...seen.values()];
  }, [f.book.events]);
  const accountsFor = (types: AccountType[]) => f.book.accounts.filter((a) => types.includes(a.type));
  const mainAccounts = accountsFor(spec.accountTypes);
  const toAccounts = accountsFor(["bank", "cash", "credit_card", "loan"]);
  // Stocks are bought and sold share by share in their own order window, not by amount here.
  const investments = accountsFor(["investment"]).filter((a) => !a.style);
  const loans = accountsFor(["loan"]);
  const owedOnLoan = (id: string) => f.state.accounts.find((a) => a.account.id === id)?.balanceMinor ?? 0;

  const [values, setValues] = useState<Values>(() => initialValues());
  // Borrowing a service or goods: what it was and its category, and no account (no money came in).
  const serviceDebt = type === "borrow" && values.borrowFor === "service";
  // An expense paid for someone: whose, too (they'll pay you back).
  const forSomeone = type === "expense" && values.forSomeone;
  const fields: FieldKey[] = serviceDebt
    ? ["person", "amount", "description", "category", "date"]
    : forSomeone
      ? [...spec.fields.filter((k) => k !== "date"), "person", "date"]
      : spec.fields;
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newParent, setNewParent] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  // A repayment larger than what was owed is saved only once confirmed, for exactly these values.
  const [overpayConfirmed, setOverpayConfirmed] = useState<string | null>(null);

  // Pay EMI on a loan with its terms: the next EMI by its schedule, from what's owed now. A new EMI is filled in with
  // it (and again when you pick another loan), unless you've typed your own figures.
  const emiLoan = type === "emi_payment" ? loans.find((a) => a.id === values.loanId) : undefined;
  const scheduledEmi = useMemo(
    () => (emiLoan?.loanTerms ? loanProgress(emiLoan, emiLoan.loanTerms, f.book, owedOnLoan(emiLoan.id)).next : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emiLoan, f.book, f.state],
  );
  const autoFilled = useRef<{ amount: string; interest: string } | null>(null);
  useEffect(() => {
    if (editing || !scheduledEmi) return;
    const mine = autoFilled.current;
    const untouched = (!values.amount && !values.interest) || (mine && values.amount === mine.amount && values.interest === mine.interest);
    if (!untouched) return;
    const next = { amount: minorToInputString(scheduledEmi.emiMinor), interest: minorToInputString(scheduledEmi.interestMinor) };
    autoFilled.current = next;
    setValues((v) => ({ ...v, ...next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledEmi?.n, values.loanId]);

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
      loanName: "",
      loanId: preset?.loanId ?? loans[0]?.id ?? "",
      interest: "",
      date: preset?.date ?? todayISO(),
      shares: [{ person: "", amount: "" }],
      splitEqually: true,
      beforeTracking: false,
      offStatement: false,
      note: "",
      billDue: "",
      borrowFor: preset?.borrowFor ?? "money",
      debtTerms: debtTermsValues(),
      repayInterest: "",
      forSomeone: false,
    };
    if (!e) return base;
    base.date = editing ? e.date : todayISO();
    base.description = e.description ?? "";
    base.offStatement = !!e.offStatement;
    base.note = e.note ?? "";
    // Editing a bill payment: the bill's date as it is now (moved in Bills, or by a later payment, it shows that).
    if (editing && e.billId) base.billDue = billFor(currentBills(), { billId: e.billId })?.dueDate ?? "";
    switch (e.type) {
      case "expense":
      case "income":
        return { ...base, amount: minorToInputString(e.amountMinor), categoryId: e.categoryId, accountId: e.accountId };
      case "transfer":
        return { ...base, amount: minorToInputString(e.amountMinor), accountId: e.fromAccountId, toAccountId: e.toAccountId };
      case "lend":
        return { ...base, amount: minorToInputString(e.amountMinor), accountId: e.accountId, person: personName(e.personId), beforeTracking: !!e.predatesRecords };
      case "borrow":
        return {
          ...base,
          amount: minorToInputString(e.amountMinor),
          accountId: e.for === "service" ? base.accountId : e.accountId,
          person: personName(e.personId),
          beforeTracking: !!e.predatesRecords,
          borrowFor: e.for ?? "money",
          categoryId: e.categoryId ?? "",
          debtTerms: debtTermsValues(e.terms),
        };
      case "repayment_received":
        return { ...base, amount: minorToInputString(e.amountMinor), accountId: e.accountId, person: personName(e.personId) };
      case "repayment_made":
        return {
          ...base,
          amount: minorToInputString(e.amountMinor),
          accountId: e.accountId,
          person: personName(e.personId),
          repayInterest: e.interestMinor ? minorToInputString(e.interestMinor) : "",
        };
      case "split_expense":
        return {
          ...base,
          amount: minorToInputString(e.totalMinor),
          categoryId: e.categoryId,
          accountId: e.accountId,
          shares: e.shares.map((s) => ({ person: personName(s.personId), amount: minorToInputString(s.amountMinor) })),
          splitEqually: e.shares.every((s) => s.amountMinor === equalShareMinor(e.totalMinor, e.shares.length)),
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
      case "trade":
        // Stock orders have their own form; nothing carries over into another kind of entry.
        return base;
      case "loan_taken":
        return { ...base, amount: minorToInputString(e.amountMinor), accountId: e.toAccountId, loanName: accountName(e.fromAccountId) };
      case "emi_payment":
        return {
          ...base,
          amount: minorToInputString(e.amountMinor),
          accountId: e.fromAccountId,
          loanId: e.toAccountId,
          interest: minorToInputString(e.interestMinor),
        };
    }
  }

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  const categories = spec.categoryKind === "income" ? f.incomeCategories : f.expenseCategories;
  // An investment can be worth nothing; every other amount must be more than zero.
  const amountMinor = parseAmountToMinor(values.amount, type === "update_valuation");

  /** For repayments: how much does this person owe / am I owed? */
  const personHint = useMemo(() => {
    if (type !== "repayment_received" && type !== "repayment_made") return null;
    const match = f.state.people.find((p) => namesOf(p.person).some((n) => n.toLowerCase() === values.person.trim().toLowerCase()));
    if (!match) return null;
    return type === "repayment_received"
      ? `${match.person.name} owes you ${formatRupees(match.owedToMe.outstandingMinor)}`
      : `You owe ${match.person.name} ${formatRupees(match.iOwe.outstandingMinor)}`;
  }, [type, values.person, f.state.people]);

  /**
   * Repayments: a warning when the amount is more than was owed on the entry's date (the entry being
   * edited left out). Null when it fits. The extra is counted as owed from before records began, which is
   * right for an old loan but hides it if they simply paid too much, so the person is asked first.
   */
  function overpayWarning(amount: number): string | null {
    if (type !== "repayment_received" && type !== "repayment_made") return null;
    const found = ensurePerson(f.getBook(), values.person);
    if (!found) return null;
    const { person } = found;
    const received = type === "repayment_received";
    // What's owed after setting what you owe each other against each other (as the People lists show it).
    const theirs = ledgerIds.receivable(person.id);
    const mine = ledgerIds.payable(person.id);
    let balance = 0;
    for (const entry of f.ledger.entries) {
      if (entry.date > values.date || entry.sourceId === editing?.id) continue;
      for (const p of entry.postings) if (p.ledger === theirs || p.ledger === mine) balance += p.amountMinor;
    }
    const owed = Math.max(received ? balance : -balance, 0);
    if (amount <= owed) return null;
    const extra = formatRupees(amount - owed);
    const name = person.name;
    if (received) {
      return owed > 0
        ? `${name} only owed you ${formatRupees(owed)} on that date. If the extra ${extra} is for a loan from before you started tracking, press Save again. If they paid you too much, save ${formatRupees(owed)} here and the extra as “Borrow / owe someone”.`
        : `${name} didn't owe you anything on that date. If this is for a loan from before you started tracking, press Save again.`;
    }
    return owed > 0
      ? `You only owed ${name} ${formatRupees(owed)} on that date. If the extra ${extra} is for a loan from before you started tracking, press Save again. If you paid too much, save ${formatRupees(owed)} here and the extra as Lend money.`
      : `You didn't owe ${name} anything on that date. If this is for a loan from before you started tracking, press Save again.`;
  }

  // Pay EMI: the interest part (0 allowed) and what is left for the loan.
  const interestMinor = parseAmountToMinor(values.interest, true);
  const principalMinor = amountMinor !== null && interestMinor !== null ? amountMinor - interestMinor : null;
  // The EMI's interest counts as spending under EMI (or Other, if EMI was removed); an edited EMI keeps its own.
  const emiCategoryId =
    editing?.type === "emi_payment" ? editing.categoryId : f.expenseCategories.some((c) => c.id === "emi") ? "emi" : "other";
  /** Take a loan: a typed name that already belongs to an account that isn't a loan. */
  const loanNameClash = () => {
    const name = values.loanName.trim().toLowerCase();
    return f.book.accounts.find((a) => a.type !== "loan" && a.name.toLowerCase() === name);
  };

  // Split equally: everyone named owes the same; any odd paisa stays in your own share.
  const namedCount = values.shares.filter((r) => r.person.trim()).length;
  const shares = values.splitEqually
    ? values.shares.map((s) => ({
        ...s,
        amount: s.person.trim() && amountMinor !== null ? minorToInputString(equalShareMinor(amountMinor, namedCount)) : "",
      }))
    : values.shares;
  const othersTotal = shares.reduce((t, s) => t + (parseAmountToMinor(s.amount) ?? 0), 0);
  const yourShare = amountMinor === null ? null : amountMinor - othersTotal;

  async function handleAddCategory() {
    const name = newCategory.trim();
    if (!name) return setCategoryError("Enter a name for the category.");
    try {
      const created = await f.addCategory(name, newParent || undefined);
      set("categoryId", created.id);
      setNewCategory("");
      setNewParent("");
      setCategoryError(null);
      setAddingCategory(false);
      setPickingCategory(false);
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : "Couldn't add that category.");
    }
  }

  function closeCategoryPicker() {
    setPickingCategory(false);
    setAddingCategory(false);
    setNewCategory("");
    setNewParent("");
  }

  /**
   * The category grid: a panel pinned to the bottom of the sheet (where a keyboard would be), so it opens in
   * view on a phone and covers the lower fields instead of pushing them off screen.
   */
  function categorySheet() {
    if (!pickingCategory || !fields.includes("category")) return null;
    const canAdd = spec.categoryKind === "expense";
    // Empty cells to fill out the last row, so the grid lines stay square.
    const filler = (3 - ((categories.length + (canAdd ? 1 : 0)) % 3)) % 3;
    return (
      <div
        data-testid="category-grid"
        className="sticky -bottom-6 z-10 -mx-6 -mb-6 border-t bg-background shadow-[0_-8px_24px_rgba(0,0,0,0.12)] max-sm:-bottom-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:-mx-5 max-sm:-mb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center justify-between bg-muted px-4 py-2">
          <span className="text-sm font-medium text-muted-foreground">Category</span>
          <button
            type="button"
            aria-label="Close categories"
            onClick={closeCategoryPicker}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="max-h-[45dvh] overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-3 gap-px border-b bg-border">
            {categories.map((c) => {
              const selected = c.id === values.categoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    set("categoryId", c.id);
                    closeCategoryPicker();
                  }}
                  className={`flex h-12 items-center justify-center gap-1.5 px-1 text-xs font-medium transition-colors sm:text-sm ${
                    selected ? "bg-primary/10 text-primary" : "bg-background hover:bg-muted"
                  }`}
                >
                  <CategoryIcon category={c} className="size-5 shrink-0" />
                  <span className="truncate" title={categoryLabel(c, categories)}>
                    {c.parentId ? `↳ ${c.name}` : c.name}
                  </span>
                </button>
              );
            })}
            {canAdd && (
              <button
                type="button"
                onClick={() => setAddingCategory(true)}
                className="flex h-12 items-center justify-center gap-1 bg-background px-1 text-xs font-medium text-primary hover:bg-muted sm:text-sm"
              >
                <Plus className="size-4" /> Add
              </button>
            )}
            {Array.from({ length: filler }, (_, i) => (
              <div key={`filler-${i}`} className="bg-background" />
            ))}
          </div>
          {canAdd && addingCategory && (
            <div className="grid gap-2 p-2 sm:grid-cols-[auto_1fr_auto]">
              <select
                aria-label="Under which category (optional)"
                value={newParent}
                onChange={(e) => setNewParent(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="">A main category</option>
                {categories
                  .filter((c) => !c.parentId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      Under {c.name}
                    </option>
                  ))}
              </select>
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
              {categoryError && <p className="text-xs text-destructive sm:col-span-3">{categoryError}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  /**
   * Paying someone back: what you owe them, the next instalment or due date, interest so far, and a box for the
   * interest part (when there is interest), with what to pay filled in on a tap.
   */
  function repayHelp() {
    const who = f.book.people.find((p) => namesOf(p).some((n) => n.toLowerCase() === values.person.trim().toLowerCase()));
    if (!who) return null;
    const d = personDebts(f.book.events.filter((e) => e.id !== editing?.id), who.id, values.date || f.today);
    const withInterest = d.debts.some((x) => x.terms?.interest) || !!values.repayInterest;
    if (d.owedMinor <= 0 && !withInterest) return null;
    const fill = () =>
      setValues((v) => ({ ...v, amount: minorToInputString(d.suggestedMinor), repayInterest: d.interestSoFarMinor > 0 ? minorToInputString(d.interestSoFarMinor) : "" }));
    return (
      <div className="grid gap-2 rounded-xl border bg-muted/40 p-3 text-sm" data-testid="repay-help">
        {d.owedMinor > 0 && (
          <>
            <p>
              You owe {who.name} <strong>{formatRupees(d.owedMinor)}</strong>
              {d.dueDate && <span className={cn(d.dueDate < f.today && "text-rose-600")}> · {d.dueDate < f.today ? "was due" : "due"} {formatDisplayDate(d.dueDate)}</span>}
            </p>
            {d.debts.map((x) => {
              const words = termsWords(x.terms, formatRupees, formatDisplayDate);
              return (
                <p key={x.eventId} className="text-xs text-muted-foreground">
                  {x.for === "service" ? x.description || "Service" : x.for === "held" ? "Keeping for them" : "Borrowed"} {formatDisplayDate(x.date)}: {formatRupees(x.owedMinor)} left{words && ` · ${words}`}
                </p>
              );
            })}
            {(d.nextInstalment || d.interestSoFarMinor > 0) && (
              <p className="text-xs">
                {d.nextInstalment && `Next instalment ${formatRupees(d.nextInstalment.amountMinor)} on ${formatDisplayDate(d.nextInstalment.date)}`}
                {d.nextInstalment && d.interestSoFarMinor > 0 && " · "}
                {d.interestSoFarMinor > 0 && `interest so far about ${formatRupees(d.interestSoFarMinor)}`}
              </p>
            )}
            <button type="button" onClick={fill} className="justify-self-start text-xs font-medium text-primary hover:underline">
              Pay {formatRupees(d.suggestedMinor)}
              {d.interestSoFarMinor > 0 ? ` (with ${formatRupees(d.interestSoFarMinor)} interest)` : d.nextInstalment ? " (this instalment)" : " (all of it)"}
            </button>
          </>
        )}
        {withInterest && (
          <div className="grid gap-1.5 border-t pt-2">
            <Label htmlFor="repay-interest">Interest part</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
              <Input id="repay-interest" amount autoComplete="off" placeholder="0" className="pl-7 tabular-nums" value={values.repayInterest} onChange={(e) => set("repayInterest", e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Counts as spending; the rest of the payment brings what you owe down.</p>
          </div>
        )}
      </div>
    );
  }

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const next: Errors = {};
    const has = (k: FieldKey) => fields.includes(k);

    if (has("amount") && amountMinor === null) next.amount = "Enter an amount, e.g. 850 or 99.50";
    if (type === "borrow") {
      const t = parseDebtTerms(values.debtTerms);
      if ("error" in t) next.form = t.error;
    }
    if (type === "repayment_made" && values.repayInterest.trim()) {
      const i = parseAmountToMinor(values.repayInterest, true);
      if (i === null) next.form = "Enter the interest part as an amount, or leave it blank.";
      else if (amountMinor !== null && i > amountMinor) next.form = "The interest can't be more than what you paid.";
    }
    if (has("description") && spec.descriptionRequired && !values.description.trim()) next.description = serviceDebt ? "Add what it was for" : "Who did you pay? A shop or a person";
    if (has("category") && !values.categoryId) next.category = "Pick a category";
    if (has("account") && !values.accountId && !values.beforeTracking) next.account = "Choose an account";
    if (has("toAccount") && !values.toAccountId) next.toAccount = "Choose an account";
    if (has("person") && !values.person.trim()) next.person = "Enter a name";
    if (has("holdingName") && !values.holdingName.trim()) next.holdingName = "Enter what you invested in";
    if (has("holdingSelect") && !values.holdingId) next.holdingSelect = "Choose an investment";
    if (has("date") && !values.date) next.date = "Pick a date";
    if (has("loanName")) {
      const clash = loanNameClash();
      if (!values.loanName.trim()) next.loanName = "Enter the loan's name, e.g. Home loan";
      else if (clash) next.loanName = `“${clash.name}” is already one of your other accounts. Give the loan its own name, e.g. ${clash.name} home loan.`;
    }
    if (has("loanSelect") && !values.loanId) next.loanSelect = "Choose a loan";
    if (has("interest")) {
      if (interestMinor === null) next.interest = "Enter the interest part of this EMI (0 if none)";
      else if (amountMinor !== null && interestMinor > amountMinor) next.interest = "Interest can't be more than the whole EMI";
    }
    if (has("soldValue") && values.soldValue.trim() && parseAmountToMinor(values.soldValue) === null) {
      next.soldValue = "Enter an amount, or leave blank to sell everything";
    }
    if (has("shares")) {
      const rows = shares.filter((s) => s.person.trim() || s.amount.trim());
      if (rows.length === 0 || rows.some((s) => !s.person.trim() || parseAmountToMinor(s.amount) === null)) {
        next.shares = values.splitEqually ? "Add each person who shares the bill" : "Add each person and the amount they owe you";
      } else if (amountMinor !== null && othersTotal > amountMinor) {
        next.shares = "Others' shares add up to more than the bill";
      }
    }
    setErrors(next);
    if (next.category) setPickingCategory(true);
    if (Object.keys(next).length > 0 || (has("amount") && amountMinor === null)) return;

    const interestPart = type === "repayment_made" && values.repayInterest.trim() ? (parseAmountToMinor(values.repayInterest, true) ?? 0) : 0;
    const warning = overpayWarning((amountMinor ?? 0) - interestPart);
    const overpayKey = `${values.person.trim().toLowerCase()}|${amountMinor}|${values.date}`;
    if (warning && overpayConfirmed !== overpayKey) {
      setOverpayConfirmed(overpayKey);
      setErrors({ form: warning });
      return;
    }

    setSaving(true);
    // Building the entry can add a new person or investment; if the entry isn't saved, take them back out.
    const before = f.getBook();
    const undoNewNames = () => {
      if (f.getBook() !== before) void f.commitBook(before);
    };
    const built = buildDraft(amountMinor ?? 0);
    // A bill date: the bill it renews gets it (found by link or name, or added), and the entry is linked to that bill.
    const bill =
      built && billApplies && values.billDue && values.description.trim()
        ? setBillDue(currentBills(), { billId: editing?.billId, name: values.description.trim(), dueDate: values.billDue, amountMinor: amountMinor ?? undefined })
        : null;
    const draft = built
      ? ({
          ...built,
          ...(offStatementApplies && values.offStatement ? { offStatement: true } : {}),
          ...noteOf(values.note),
          ...(bill ? { billId: bill.billId } : {}),
        } as EventDraft)
      : built;
    if (!draft) {
      undoNewNames();
      setErrors({ form: "Something is missing. Please check the form." });
      setSaving(false);
      return;
    }

    const result = editing ? f.updateEvent(editing.id, draft) : f.addEvent(draft);
    if (!result.ok) {
      undoNewNames();
      setErrors({ form: result.issues[0]?.message ?? "That can't be saved." });
      setSaving(false);
      return;
    }
    if (bill) updateBills(() => bill.data);
    onSaved(result.value, !!editing);
  }

  function buildDraft(amount: number): EventDraft | null {
    const description = values.description.trim() || undefined;
    const date = values.date;
    const personId = () => f.resolvePerson(values.person);

    switch (type) {
      case "expense": {
        // Paid on someone else's behalf: not your spending; they owe it until they pay you back.
        if (values.forSomeone) {
          const id = personId();
          return id ? { type: "reimbursable_expense", date, description, accountId: values.accountId, amountMinor: amount, categoryId: values.categoryId, personId: id } : null;
        }
        return { type, date, description, accountId: values.accountId, amountMinor: amount, categoryId: values.categoryId };
      }
      case "income":
        return { type, date, description, accountId: values.accountId, amountMinor: amount, categoryId: values.categoryId };
      case "transfer":
        return { type, date, fromAccountId: values.accountId, toAccountId: values.toAccountId, amountMinor: amount };
      case "lend":
      case "borrow": {
        const id = personId();
        if (!id) return null;
        const parsed = type === "borrow" ? parseDebtTerms(values.debtTerms) : {};
        const terms = "terms" in parsed && parsed.terms ? { terms: parsed.terms } : {};
        if (type === "borrow" && serviceDebt) {
          return { type, date, personId: id, accountId: "", amountMinor: amount, for: "service", categoryId: values.categoryId, ...(description ? { description } : {}), ...terms };
        }
        return {
          type,
          date,
          personId: id,
          accountId: values.accountId,
          amountMinor: amount,
          ...(type === "borrow" && values.borrowFor === "held" ? { for: "held" as const } : {}),
          ...(values.beforeTracking ? { predatesRecords: true } : {}),
          ...terms,
        };
      }
      case "repayment_received":
      case "repayment_made": {
        // The original loan may be from before these records began, or in cash: don't insist it was entered.
        const id = personId();
        if (!id) return null;
        // Interest paid on top counts as spending (under EMI, like a loan's interest); the rest pays the debt down.
        const interest = type === "repayment_made" && values.repayInterest.trim() ? parseAmountToMinor(values.repayInterest, true) : null;
        return {
          type,
          date,
          personId: id,
          accountId: values.accountId,
          amountMinor: amount,
          predatesRecords: true,
          ...(type === "repayment_made" && interest ? { interestMinor: interest, categoryId: emiCategoryId } : {}),
        };
      }
      case "split_expense": {
        const owed: { personId: string; amountMinor: number }[] = [];
        for (const s of shares.filter((r) => r.person.trim())) {
          const id = f.resolvePerson(s.person);
          const share = parseAmountToMinor(s.amount);
          if (!id || share === null) return null;
          owed.push({ personId: id, amountMinor: share });
        }
        return { type, date, description, accountId: values.accountId, totalMinor: amount, categoryId: values.categoryId, shares: owed };
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
      case "trade":
        return null;
      case "loan_taken": {
        const loanId = f.resolveLoan(values.loanName, date);
        return loanId ? { type, date, fromAccountId: loanId, toAccountId: values.accountId, amountMinor: amount } : null;
      }
      case "emi_payment":
        if (interestMinor === null) return null;
        return {
          type,
          date,
          fromAccountId: values.accountId,
          toAccountId: values.loanId,
          amountMinor: amount,
          interestMinor,
          categoryId: emiCategoryId,
        };
    }
  }

  /* ---------------- field renderers ---------------- */

  const label = (key: FieldKey, fallback: string) =>
    serviceDebt && key === "person" ? "Who do you owe?" : forSomeone && key === "person" ? "Who did you pay for? (they'll pay you back)" : serviceDebt && key === "description" ? "What was it for?" : serviceDebt && key === "amount" ? "Amount you owe" : (spec.labels[key] ?? fallback);

  const field = (key: FieldKey): ReactNode => {
    switch (key) {
      case "amount":
        return (
          <Field key={key} id="amount" label={label("amount", "Amount")} error={errors.amount}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
              <Input
                id="amount"
                amount
                autoComplete="off"
                autoFocus={!editing && !preset?.person && !preset?.holdingId}
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
            <PersonInput
              id="description"
              maxLength={80}
              // Who: the shop or person paid (or who paid you). What it was for goes in Reason.
              placeholder={type === "income" ? "e.g. Acme Pvt Ltd" : serviceDebt ? "e.g. Bike repair" : "e.g. Swiggy, or a person's name"}
              value={values.description}
              onChange={(v) => set("description", v)}
              people={knownDescriptions}
              invalid={!!errors.description}
            />
          </Field>
        );

      case "category": {
        const chosen = categories.find((c) => c.id === values.categoryId);
        return (
          // Paid for someone: the category only says what it was; it's money they owe you, not your spending.
          <Field
            key={key}
            id="category"
            label={type === "reimbursable_expense" || forSomeone ? "What was it? (not counted as your spending)" : "Category"}
            error={errors.category}
          >
            <button
              type="button"
              id="category"
              aria-expanded={pickingCategory}
              aria-invalid={!!errors.category}
              onClick={() => (pickingCategory ? closeCategoryPicker() : setPickingCategory(true))}
              className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
            >
              {chosen ? (
                <>
                  <CategoryIcon category={chosen} />
                  <span className="truncate">{categoryLabel(chosen, categories)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Select</span>
              )}
              <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
            </button>
          </Field>
        );
      }

      case "account": {
        const accountField = (
          <AccountField
            key={key}
            id="account"
            label={label("account", "Account")}
            value={values.accountId}
            onChange={(v) => {
              set("accountId", v);
              // A transfer can't go to the account it comes from: clear "To" rather than leave it hidden but set.
              if (type === "transfer" && v === values.toAccountId) set("toAccountId", "");
            }}
            accounts={mainAccounts}
            error={errors.account}
          />
        );
        if (type !== "lend" && type !== "borrow") return accountField;
        // Not in statement: a debt from before you started tracking. It counts in what you owe (or are owed), but no account moves.
        return (
          <AccountField
            key={key}
            id="account"
            label={label("account", "Account")}
            value={values.accountId}
            onChange={(v) => set("accountId", v)}
            accounts={mainAccounts}
            error={errors.account}
            toggle={{ label: "Not in statement", on: values.beforeTracking, onChange: (on) => set("beforeTracking", on) }}
            note={values.beforeTracking ? `No account changes, only ${type === "borrow" ? "what you owe" : "what you're owed"}.` : undefined}
          />
        );
      }

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
            <PersonInput
              id="person"
              autoFocus={!!preset?.person ? false : !editing}
              placeholder="e.g. Rahul"
              value={values.person}
              onChange={(v) => set("person", v)}
              people={f.book.people.map((p) => p.name)}
              invalid={!!errors.person}
            />
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
              amount
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

      case "loanName": {
        const existing = loans.find((a) => a.name.toLowerCase() === values.loanName.trim().toLowerCase());
        return (
          <Field key={key} id="loanName" label={label("loanName", "Loan")} error={errors.loanName}>
            <Input
              id="loanName"
              list="loans-list"
              autoComplete="off"
              autoFocus={!editing}
              maxLength={50}
              placeholder="e.g. Home loan, HDFC car loan"
              value={values.loanName}
              onChange={(e) => set("loanName", e.target.value)}
              aria-invalid={!!errors.loanName}
            />
            <datalist id="loans-list">
              {loans.map((a) => (
                <option key={a.id} value={a.name} />
              ))}
            </datalist>
            {values.loanName.trim() && (
              <p className="text-xs text-muted-foreground">
                {existing
                  ? `You owe ${formatRupees(owedOnLoan(existing.id))} on it now. This adds to it.`
                  : "A new loan is added under Loans on the Money page."}
                {(!existing || !existing.loanTerms) &&
                  " Add its interest rate and tenure there (or use “Add a loan” on the Money page) to get its EMI, schedule and reminders."}
              </p>
            )}
          </Field>
        );
      }

      case "loanSelect":
        return loans.length === 0 ? (
          <p key={key} className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
            You don&apos;t have a loan yet. For a new loan, record it with Take a loan. For one you&apos;re already repaying, add it on
            the Money page with what you still owe.
          </p>
        ) : (
          <Field key={key} id="loan" label={label("loanSelect", "Loan")} error={errors.loanSelect}>
            <Select value={values.loanId} onValueChange={(v) => (v ? set("loanId", v) : undefined)}>
              <SelectTrigger id="loan" aria-invalid={!!errors.loanSelect}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {loans.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="flex items-center gap-2">
                      <BankMark name={a.name} accountId={a.id} fallback={<PictureIcon name="loan" />} />
                      {a.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {values.loanId && <p className="text-xs text-muted-foreground">You owe {formatRupees(owedOnLoan(values.loanId))} on it now.</p>}
          </Field>
        );

      case "interest":
        return (
          <Field key={key} id="interest" label="Interest part" error={errors.interest}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
              <Input
                id="interest"
                amount
                autoComplete="off"
                placeholder="0"
                className="pl-7 tabular-nums"
                value={values.interest}
                onChange={(e) => set("interest", e.target.value)}
                aria-invalid={!!errors.interest}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {principalMinor !== null && principalMinor >= 0 && interestMinor !== null
                ? `${formatRupees(principalMinor)} pays the loan down · ${formatRupees(interestMinor)} counts as spending`
                : "Your loan's repayment schedule shows how much of each EMI is interest."}
            </p>
            {scheduledEmi && (
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid="emi-schedule-hint">
                <span>
                  By the schedule, EMI {scheduledEmi.n} ({scheduledEmi.date.split("-").reverse().join("-")}) is {formatRupees(scheduledEmi.emiMinor)}: {formatRupees(scheduledEmi.interestMinor)} interest.
                </span>
                {(values.amount !== minorToInputString(scheduledEmi.emiMinor) || values.interest !== minorToInputString(scheduledEmi.interestMinor)) && (
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => setValues((v) => ({ ...v, amount: minorToInputString(scheduledEmi.emiMinor), interest: minorToInputString(scheduledEmi.interestMinor) }))}
                  >
                    Use these
                  </button>
                )}
              </p>
            )}
          </Field>
        );

      case "shares": {
        const updateRow = (i: number, row: Partial<Values["shares"][number]>) =>
          set("shares", values.shares.map((r, j) => (j === i ? { ...r, ...row } : r)));
        return (
          <div key={key} className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Who owes you a share?</Label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                Split equally
                <Switch
                  checked={values.splitEqually}
                  onCheckedChange={(on) => {
                    // Turning it off keeps the equal amounts as a starting point to change.
                    if (!on) set("shares", shares);
                    set("splitEqually", on);
                  }}
                  aria-label="Split equally"
                  className={values.splitEqually ? undefined : "bg-slate-300 dark:bg-slate-600"}
                />
              </label>
            </div>
            {shares.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <PersonInput
                  value={row.person}
                  onChange={(person) => updateRow(i, { person })}
                  people={f.book.people.map((p) => p.name)}
                  taken={values.shares.filter((_, j) => j !== i).map((r) => r.person)}
                />
                <div className="relative w-32 shrink-0">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                  <Input
                    amount
                    autoComplete="off"
                    placeholder="0"
                    aria-label={`${row.person.trim() || "Their"} share`}
                    readOnly={values.splitEqually}
                    className={`pl-7 tabular-nums ${values.splitEqually ? "bg-muted/50 text-muted-foreground" : ""}`}
                    value={row.amount}
                    onChange={(e) => updateRow(i, { amount: e.target.value })}
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
      }

      case "date":
        return (
          <Field key={key} id="date" label="Date" error={errors.date}>
            <Input id="date" type="date" value={values.date} onChange={(e) => set("date", e.target.value)} aria-invalid={!!errors.date} />
          </Field>
        );
    }
  };

  // Not in bank statement: only a bank account's balance follows its statement, so the switch matters only when one is used.
  const involved = [values.accountId, fields.includes("toAccount") ? values.toAccountId : ""];
  const usesBank = involved.some((id) => f.book.accounts.find((a) => a.id === id)?.type === "bank");
  const hasOffStatement = fields.includes("account") && !values.beforeTracking;
  const offStatementApplies = hasOffStatement && usesBank;

  // The bill date: on a bill or subscription payment, or any expense already linked to a bill.
  const chosenCategory = f.expenseCategories.find((c) => c.id === values.categoryId);
  const billApplies =
    BILL_TYPES.has(type) &&
    (!!values.billDue || !!editing?.billId || (!!chosenCategory && (BILL_CATEGORIES.has(chosenCategory.id) || BILL_CATEGORIES.has(chosenCategory.parentId ?? ""))));
  const knownBill = billApplies ? billFor(billsData, { billId: editing?.billId, name: values.description }) : undefined;

  // Put short fields (account/date, etc.) side by side where it reads naturally.
  const noAccountsForType = fields.includes("account") && mainAccounts.length === 0;
  // Pay EMI needs a loan to pay; the loan field explains how to add one.
  const noLoanToPay = fields.includes("loanSelect") && loans.length === 0;

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
              {/* Closed: the chosen kind's picture and name. */}
              <SelectValue>
                <span className="flex items-center gap-2">
                  <PictureIcon name={option.picture} className="size-6" />
                  {option.label}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {/* Stock trades have their own order window, so an entry can't be switched into one here. */}
              {EVENT_OPTIONS.filter(
                (o) =>
                  (o.type !== "update_valuation" || type === "update_valuation") &&
                  o.type !== "trade" &&
                  // Only kinds that move money the same way as the entry did: money in stays money in, out stays out.
                  (o.type === editing.type || sameDirection(editing.type, o.type, lineDirection)),
              ).map((o) => (
                <SelectItem key={o.type} value={o.type}>
                  {/* Each kind with its picture (as in "What happened?"), and what it means under its name. */}
                  <span className="flex items-center gap-2.5 py-0.5">
                    <PictureIcon name={o.picture} className="size-7" />
                    <span className="grid">
                      <span className="font-medium">{o.label}</span>
                      <span className="text-xs text-muted-foreground">{o.hint}</span>
                    </span>
                  </span>
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
        <>
          {type === "borrow" && (
            <div className="grid gap-1.5">
              <Label>What was it?</Label>
              <div role="radiogroup" aria-label="What was it?" className="grid grid-cols-3 gap-1 rounded-lg border bg-muted p-0.5 text-sm" data-testid="borrow-for">
                {(
                  [
                    ["money", "Borrowed", "A loan to me"],
                    ["held", "Keeping it for them", "Theirs: to give back or spend for them"],
                    ["service", "Service or goods", "I'll pay for it later"],
                  ] as const
                ).map(([v, title, hint]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={values.borrowFor === v}
                    onClick={() => set("borrowFor", v)}
                    className={cn("rounded-md px-2 py-1.5 text-left", values.borrowFor === v ? "bg-card shadow-sm" : "text-muted-foreground")}
                  >
                    <span className="block font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
              {serviceDebt && <p className="text-xs text-muted-foreground">It counts as spending now, under its category, and as owed to them until you pay.</p>}
              {type === "borrow" && values.borrowFor === "held" && (
                <p className="text-xs text-muted-foreground">Not your income: it&apos;s theirs until you hand it back (Paid someone back) or pay for something of theirs.</p>
              )}
            </div>
          )}
          {/* Paid for someone: their name comes right under the switch, not among the fields above it. */}
          {fields.filter((k) => !(forSomeone && k === "person")).map((k) => field(k))}
          {type === "expense" && !editing && (
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5" data-testid="paid-for-someone">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">I paid this for someone else</span>
                <span className="block text-xs text-muted-foreground">
                  {values.forSomeone ? "Not your spending: they owe you this until they pay you back (Got paid back settles it)." : "Turn on if someone will pay you back for it."}
                </span>
              </span>
              <Switch checked={values.forSomeone} onCheckedChange={(on) => set("forSomeone", on)} aria-label="I paid this for someone else" className={values.forSomeone ? undefined : "bg-slate-300 dark:bg-slate-600"} />
            </label>
          )}
          {forSomeone && field("person")}
          {type === "borrow" && <DebtTermsFields value={values.debtTerms} onChange={(v) => set("debtTerms", v)} startOpen={!!preset?.withTerms} />}
          {/* Called, not mounted: a component defined in here would remount each render and drop the cursor. */}
          {type === "repayment_made" && repayHelp()}
        </>
      )}

      {billApplies && !noAccountsForType && (
        <Field id="bill-due" label="Bill expires / due again (optional)">
          <Input id="bill-due" type="date" min={values.date || undefined} value={values.billDue} onChange={(e) => set("billDue", e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {values.billDue
              ? knownBill
                ? `Updates “${knownBill.name}” in Bills, so you're reminded before it runs out.`
                : `Adds “${values.description.trim() || "this bill"}” to Bills, so you're reminded before it runs out.`
              : knownBill
                ? `“${knownBill.name}” is in Bills, due ${knownBill.dueDate.split("-").reverse().join("-")}. Set the new date if this payment renews it.`
                : "When the plan runs out or the next bill is due. It's added to Bills and the calendar, and reminds you."}
          </p>
        </Field>
      )}

      {!noAccountsForType && <NoteField value={values.note} onChange={(v) => set("note", v)} />}

      {hasOffStatement && !noAccountsForType && (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5" data-testid="off-statement">
          <FileTypeIcon filename="statement.pdf" className="h-6 w-5" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Not in bank statement</span>
            <span className="block text-xs text-muted-foreground">
              {!usesBank
                ? "Cash and cards don't follow a bank statement, so this counts as you entered it."
                : values.offStatement
                  ? "Your bank won't show this, so it's counted on top of the statement's balance."
                  : "Turn on if your bank statement won't show this."}
            </span>
          </span>
          <Switch
            checked={!usesBank || values.offStatement}
            disabled={!usesBank}
            onCheckedChange={(on) => set("offStatement", on)}
            aria-label="Not in bank statement"
            className={!usesBank || values.offStatement ? undefined : "bg-slate-300 dark:bg-slate-600"}
          />
        </label>
      )}

      {errors.form && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{errors.form}</p>}

      <DialogFooter>
        <Button type="submit" disabled={saving || noAccountsForType || noLoanToPay}>
          {editing ? "Save changes" : "Save"}
        </Button>
      </DialogFooter>
      {categorySheet()}
    </form>
  );
}

const MONEY_IN = new Set<EventType>(["income", "borrow", "repayment_received", "loan_taken", "sell_investment"]);
const MONEY_OUT = new Set<EventType>(["expense", "lend", "repayment_made", "emi_payment", "split_expense", "reimbursable_expense", "invest"]);

/**
 * Whether an entry recorded as `from` can be changed into `to` without the money changing direction: money that came
 * in stays money in (income, got paid back, borrowed…), money that went out stays out (expense, lent, paid back…).
 * Transfer fits either, and an entry that was a transfer can become anything.
 */
function sameDirection(from: EventType, to: EventType, line?: "credit" | "debit"): boolean {
  // From a bank statement: what the bank says happened decides, whatever the entry is recorded as now.
  if (line) return to === "transfer" || (line === "credit" ? MONEY_IN.has(to) : MONEY_OUT.has(to));
  if (to === from || to === "transfer") return true;
  if (MONEY_IN.has(from)) return MONEY_IN.has(to);
  if (MONEY_OUT.has(from)) return MONEY_OUT.has(to);
  return true;
}

/** One person's share of a bill split equally between you and `others` people (rounded down to the paisa). */
function equalShareMinor(totalMinor: number, others: number): number {
  return others > 0 ? Math.floor(totalMinor / (others + 1)) : 0;
}

/**
 * A name box that offers the people already in your records as you type (a datalist barely shows on
 * iPhone). Names in `taken`, used elsewhere on the form, aren't offered again.
 */
function PersonInput({
  id,
  value,
  onChange,
  people,
  taken = [],
  placeholder = "Name",
  autoFocus,
  invalid,
  maxLength = 40,
}: {
  id?: string;
  value: string;
  onChange: (name: string) => void;
  people: string[];
  taken?: string[];
  placeholder?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const typed = value.trim().toLowerCase();
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  const starts = (n: string) => (n.toLowerCase().startsWith(typed) ? 0 : 1);
  // Offered only once something is typed; a name that matches no one is simply saved as a new person.
  const matches = !typed
    ? []
    : people
    .filter((n) => !used.has(n.toLowerCase()) && n.toLowerCase() !== typed && n.toLowerCase().includes(typed))
    .sort((a, b) => starts(a) - starts(b) || a.localeCompare(b))
    .slice(0, 6);
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        id={id}
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        aria-invalid={invalid}
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
      />
      {open && matches.length > 0 && (
        <ul
          role="listbox"
          className="glass-pop absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border p-1 shadow-lg"
        >
          {matches.map((name) => (
            <li key={name} role="option" aria-selected={false}>
              <button
                type="button"
                // Pick on press, before the box loses focus and closes the list.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className="w-full truncate rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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

export function AccountField({
  id,
  label,
  value,
  onChange,
  accounts,
  error,
  toggle,
  note,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  accounts: { id: string; name: string; type: AccountType }[];
  error?: string;
  /** A switch beside the label (say, "Not in statement"); while on, no account is chosen. */
  toggle?: { label: string; on: boolean; onChange: (on: boolean) => void };
  note?: string;
}) {
  const hidden = !!toggle?.on;
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {!hidden && (
        // Ignore the empty value Radix's hidden native select can briefly report.
        <Select value={value} onValueChange={(v) => (v ? onChange(v) : undefined)}>
          <SelectTrigger id={id} aria-invalid={!!error}>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-2">
                  <BankMark name={a.name} accountId={a.id} fallback={<PictureIcon name={accountPicture(a)} />} />
                  {a.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {error && !hidden && <p className="text-xs text-destructive">{error}</p>}
      {toggle && (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
          <FileTypeIcon filename="statement.pdf" className="h-6 w-5" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{toggle.label}</span>
            {note && <span className="block text-xs text-muted-foreground">{note}</span>}
          </span>
          <Switch
            checked={toggle.on}
            onCheckedChange={toggle.onChange}
            aria-label={toggle.label}
            className={toggle.on ? undefined : "bg-slate-300 dark:bg-slate-600"}
          />
        </label>
      )}
    </div>
  );
}
