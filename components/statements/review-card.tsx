"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, Equal, EqualNot, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatWeekdayDate } from "@/lib/domain/dates";
import { formatRupees } from "@/lib/finance/describe";
import { missingInfo } from "@/lib/statements/plan";
import { PERSON_EVENTS, type Classification, type StatementEventType, type StatementRow } from "@/lib/statements/types";
import { cn } from "@/lib/utils";
import type { FinancialEvent } from "@/lib/finance/types";
import type { Decision } from "@/lib/statements/pipeline";
import { useFinance } from "../finance-provider";
import { useToast } from "../toast";
import { describeClassification, EVENT_LABEL, optionsFor, signedAmount, SOURCE_LABEL } from "./labels";
import { CategorySelect, CounterAccountSelect } from "./pickers";
import { useStatements } from "./statements-provider";
import { ViewInStatement } from "./source-viewer";

/** Which extra answers each choice needs before it can become an entry. */
export function needs(type: StatementEventType, direction: StatementRow["direction"]) {
  return {
    person: PERSON_EVENTS.includes(type),
    category: type === "EXPENSE" || type === "INCOME" || (type === "REIMBURSEMENT" && direction === "debit"),
    account: type === "TRANSFER" || type === "CREDIT_CARD_PAYMENT" || type === "LOAN_REPAYMENT",
    holding: type === "INVESTMENT" || type === "INVESTMENT_SELL",
  };
}

/** Compare a possible duplicate with the thing it might duplicate, side by side. */
function DuplicateCompare({ row, others }: { row: StatementRow; others: StatementRow[] }) {
  const { book, describer } = useFinance();
  const statements = useStatements();
  const match = row.match!;
  const event = match.eventId ? book.events.find((e) => e.id === match.eventId) : undefined;
  const otherRow = match.otherRowId ? others.find((r) => r.id === match.otherRowId) : undefined;

  const Side = ({ title, date, text, amount, sub }: { title: string; date: string; text: string; amount: string; sub?: string }) => (
    <div className="min-w-0 flex-1 rounded-xl border bg-muted/40 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1 text-sm font-medium">{formatWeekdayDate(date)}</div>
      <div className="mt-1 break-words text-sm">{text}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      <div className="mt-1.5 text-base font-semibold tabular-nums">{amount}</div>
    </div>
  );

  return (
    <div className="mt-3" data-testid="duplicate-compare">
      <p className="mb-2 text-sm text-muted-foreground">{match.reason}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <Side title="In this statement" date={row.transactionDate} text={row.rawDescription} amount={signedAmount(row.direction, row.amountMinor)} sub={row.referenceNumber ? `Ref ${row.referenceNumber}` : "No reference number"} />
        {event ? (
          <Side title="Already in your records" date={event.date} text={describer.title(event)} sub={describer.subtitle(event)} amount={formatRupees(row.amountMinor)} />
        ) : otherRow ? (
          <Side title="Another line in this statement" date={otherRow.transactionDate} text={otherRow.rawDescription} amount={signedAmount(otherRow.direction, otherRow.amountMinor)} sub={otherRow.referenceNumber ? `Ref ${otherRow.referenceNumber}` : "No reference number"} />
        ) : (
          <Side title="Other" date={row.transactionDate} text="That entry no longer exists" amount="" />
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => statements.resolve(row.id, { kind: "same" })}>
          <Equal /> Same transaction
        </Button>
        <Button size="sm" variant="outline" onClick={() => statements.resolve(row.id, { kind: "different" })}>
          <EqualNot /> Different transaction
        </Button>
      </div>
    </div>
  );
}

/**
 * One line that needs a person. The usual case is one click: confirm the suggestion, or tap what
 * it really was. Choices that need a detail (who, which account...) ask for just that detail.
 */
export function ReviewCard({ row, siblings, compact = false }: { row: StatementRow; siblings: StatementRow[]; compact?: boolean }) {
  const { book, expenseCategories, incomeCategories, updateEvent } = useFinance();
  const statements = useStatements();
  const toast = useToast();
  const c = row.classification;
  // After an answer: "is this name always that?" Yes teaches it for good; "just this once" keeps it to this line.
  const [ask, setAsk] = useState<{ decision: Extract<Decision, { kind: "classify" | "accept" }>; label: string; eventType: StatementEventType; category: string | null } | null>(null);

  const name = row.normalized.counterparty;
  const nameKey = (s: string | undefined | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  /** Other lines, in any statement still open, from the same name and in the same direction. */
  const sameNameLines = () =>
    statements.imports
      .filter((i) => i.status !== "IMPORTED" && i.status !== "FAILED")
      .flatMap((i) => statements.rowsOf(i.id))
      .filter(
        (r) =>
          r.id !== row.id &&
          r.direction === row.direction &&
          r.normalized.counterpartyKey === row.normalized.counterpartyKey &&
          r.decision?.by !== "user" &&
          (r.status === "review" || r.status === "auto" || r.status === "auto_flagged"),
      );

  const categoryFor = (eventType: StatementEventType, category: string | null) => {
    if (!category || (eventType !== "EXPENSE" && eventType !== "INCOME")) return undefined;
    const list = eventType === "EXPENSE" ? expenseCategories : incomeCategories;
    return list.find((x) => x.name.toLowerCase() === category.toLowerCase());
  };

  /** Entries already recorded under this name whose category would change. */
  const pastEntries = (eventType: StatementEventType, category: string | null): FinancialEvent[] => {
    const target = categoryFor(eventType, category);
    if (!target) return [];
    const type = eventType === "EXPENSE" ? "expense" : "income";
    return book.events.filter((e) => e.type === type && nameKey(e.description) === nameKey(name) && "categoryId" in e && e.categoryId !== target.id);
  };

  const decide = (decision: Extract<Decision, { kind: "classify" | "accept" }>, eventType: StatementEventType, category: string | null, label: string) => {
    // Nothing to remember without a name, and a name already settled for good needs no question.
    if (!row.normalized.counterpartyKey || (decision.kind === "accept" && c?.source === "user_rule" && c.confidence >= 0.99)) {
      const res = statements.resolve(row.id, decision);
      if (!res.ok) setError(res.message);
      return res.ok;
    }
    setError(null);
    setAsk({ decision, label, eventType, category });
    return true;
  };

  const answer = (always: boolean) => {
    if (!ask) return;
    const res = statements.resolve(row.id, { ...ask.decision, scope: always ? "always" : "once" });
    if (!res.ok) {
      setError(res.message);
      setAsk(null);
      return;
    }
    if (always) {
      const target = categoryFor(ask.eventType, ask.category);
      let updated = 0;
      for (const e of pastEntries(ask.eventType, ask.category)) {
        if (!target) break;
        const { id, createdAt: _created, updatedAt: _updated, ...draft } = e;
        if (updateEvent(id, { ...draft, categoryId: target.id } as Parameters<typeof updateEvent>[1]).ok) updated++;
      }
      const parts = [
        res.applied ? `${res.applied} other ${res.applied === 1 ? "line" : "lines"}` : "",
        updated ? `${updated} past ${updated === 1 ? "entry" : "entries"}` : "",
      ].filter(Boolean);
      toast.show({ message: `Remembered: “${name}” is always ${ask.label}${parts.length ? ` · updated ${parts.join(" and ")}` : ""}` });
    }
    setAsk(null);
  };
  const [picking, setPicking] = useState<StatementEventType | null>(null);
  const [error, setError] = useState<string | null>(row.error ?? null);
  const [form, setForm] = useState({ person: "", category: "", account: "", holding: "" });

  const options = useMemo(() => optionsFor(row.direction, c), [row.direction, c]);
  const suggestionIssue = c ? missingInfo(row, c, book) : "No suggestion";
  const categoryList = (row.direction === "credit" ? incomeCategories : expenseCategories).map((x) => x.name);

  const accountChoices = (type: StatementEventType) =>
    book.accounts.filter((a) => a.id !== row.accountId && (type === "CREDIT_CARD_PAYMENT" ? a.type === "credit_card" : type === "LOAN_REPAYMENT" ? a.type === "loan" : a.type === "bank" || a.type === "cash"));

  /** Starting values for a choice, reusing what the suggestion already knows. */
  const prefill = (type: StatementEventType) => {
    const sameType = c?.eventType === type;
    const n = needs(type, row.direction);
    return {
      person: n.person ? (c?.person ?? row.normalized.counterparty ?? "") : "",
      category: n.category ? (sameType && c?.category ? c.category : row.direction === "credit" ? "Other income" : "Other") : "",
      account: n.account ? (sameType ? (c?.counterAccountId ?? "") : (accountChoices(type).length === 1 ? accountChoices(type)[0].id : "")) : "",
      holding: n.holding ? (c?.holding ?? row.normalized.counterparty ?? "") : "",
    };
  };

  const submit = (type: StatementEventType, f: typeof form) => {
    const decision = {
      kind: "classify" as const,
      eventType: type,
      category: f.category || null,
      person: f.person.trim() || null,
      counterAccountId: f.account || null,
      holding: f.holding.trim() || null,
    };
    const asClassification: Classification = { source: "user", merchant: null, confidence: 1, reason: "", alternatives: [], ...decision };
    const ok = decide(decision, type, decision.category, describeClassification(asClassification, row.direction, book.accounts));
    if (ok) setPicking(null);
    return ok;
  };

  const choose = (type: StatementEventType) => {
    const f = prefill(type);
    const n = needs(type, row.direction);
    const mustAsk = (n.category && c?.eventType !== type) || n.person || n.account || n.holding;
    // A person's name is the one thing that is always worth a glance, so show it even when known.
    if (!mustAsk || (n.person && f.person && c?.eventType === type && c.person && !c.person.includes("-"))) {
      if (submit(type, f)) return;
    }
    setForm(f);
    setPicking(type);
  };

  const n = picking ? needs(picking, row.direction) : null;
  const fieldsOk = picking && n ? (!n.person || form.person.trim()) && (!n.category || form.category) && (!n.account || form.account) && (!n.holding || form.holding.trim()) : false;

  return (
    <div className={cn("glass rounded-2xl border p-4", row.status === "possible_duplicate" && "border-amber-300")} data-testid="review-card" data-row={row.id}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">
            {formatWeekdayDate(row.transactionDate)} · line {row.index + 1}
            {row.sourcePage > 1 ? ` · page ${row.sourcePage}` : ""}
          </div>
          <div className="mt-0.5 break-words text-sm font-medium">{row.normalized.counterparty || row.rawDescription}</div>
          <div className="break-words font-mono text-[11px] leading-snug text-muted-foreground">{row.rawDescription}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className={cn("text-lg font-semibold tabular-nums", row.direction === "credit" ? "text-emerald-700" : "text-foreground")}>{signedAmount(row.direction, row.amountMinor)}</div>
          <ViewInStatement row={row} className="h-7 px-2 text-xs" />
        </div>
      </div>

      {row.rawData.warnings.length > 0 && <p className="mt-2 text-xs text-amber-700">⚠ {row.rawData.warnings[0]}</p>}
      {row.error && <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{row.error}</p>}

      {row.status === "possible_duplicate" && row.match ? (
        <DuplicateCompare row={row} others={siblings} />
      ) : (
        <>
          {ask && (
            <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="always-ask">
              <p>
                Is <strong>{name}</strong> always <strong>{ask.label}</strong>?
                <span className="block text-xs text-muted-foreground">
                  {(() => {
                    const lines = sameNameLines().length;
                    const past = pastEntries(ask.eventType, ask.category).length;
                    const bits = [lines ? `${lines} other waiting ${lines === 1 ? "line" : "lines"}` : "", past ? `${past} past ${past === 1 ? "entry" : "entries"}` : ""].filter(Boolean);
                    return `“Yes” also updates ${bits.length ? bits.join(" and ") : "future lines"}, and is remembered.`;
                  })()}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => answer(true)} data-testid="always-yes">
                  <Check /> Yes, always
                </Button>
                <Button size="sm" variant="outline" onClick={() => answer(false)} data-testid="always-once">
                  Just this once
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setAsk(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {c && !ask && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                {c.source === "ai" && <Sparkles className="size-3" />}
                {SOURCE_LABEL[c.source]} · {Math.round(c.confidence * 100)}%
              </span>
              <span>{c.reason}</span>
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {c && !suggestionIssue && (
              <Button size="sm" onClick={() => decide({ kind: "accept" }, c.eventType, c.category, describeClassification(c, row.direction, book.accounts))} data-testid="accept-suggestion">
                <Check /> {describeClassification(c, row.direction, book.accounts)}
              </Button>
            )}
            {!picking && c && !suggestionIssue && needs(c.eventType, row.direction).category && (
              <div className="flex items-center gap-1.5" data-testid="category-pick">
                <span className="text-xs text-muted-foreground">Category</span>
                <CategorySelect
                  names={categoryList}
                  value=""
                  placeholder={c.category ?? "Pick…"}
                  allowNew={row.direction === "debit"}
                  className="h-8 w-44"
                  ariaLabel="Pick a category"
                  onChange={(cat) =>
                    decide(
                      { kind: "classify", eventType: c.eventType, category: cat, person: c.person, counterAccountId: c.counterAccountId, holding: c.holding },
                      c.eventType,
                      cat,
                      describeClassification({ ...c, category: cat }, row.direction, book.accounts),
                    )
                  }
                />
              </div>
            )}
            <div className="flex items-center gap-1.5" data-testid="type-pick">
              <span className="text-xs text-muted-foreground">Type</span>
              <Select value={picking ?? ""} onValueChange={(t) => choose(t as StatementEventType)}>
                <SelectTrigger className="h-8 w-56" aria-label="Type">
                  <SelectValue placeholder={c ? EVENT_LABEL[c.eventType] : "Choose type"} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((t) => (
                    <SelectItem key={t} value={t} data-testid={`choose-${t}`}>
                      {EVENT_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {picking && n?.category && (
              <div className="flex items-center gap-1.5" data-testid="category-inline">
                <span className="text-xs text-muted-foreground">Category</span>
                <CategorySelect
                  names={categoryList}
                  value={form.category}
                  placeholder="Choose"
                  allowNew={row.direction === "debit"}
                  className="h-8 w-44"
                  ariaLabel="Category"
                  onChange={(v) => setForm({ ...form, category: v })}
                />
              </div>
            )}
            {picking && n && !n.person && !n.account && !n.holding && (
              <Button size="sm" disabled={!fieldsOk} onClick={() => submit(picking, form)} data-testid="save-choice">
                <ArrowRight /> Save
              </Button>
            )}
            <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => statements.resolve(row.id, { kind: "skip" })}>
              <X /> Skip this line
            </Button>
          </div>

          {picking && n && (n.person || n.account || n.holding) && (
            <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border bg-muted/40 p-3" data-testid="review-form">
              {n.person && (
                <label className="min-w-40 flex-1 text-xs font-medium">
                  Who is it with?
                  <Input list={`people-${row.id}`} value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} placeholder="Name" className="mt-1" aria-label="Person" />
                  <datalist id={`people-${row.id}`}>
                    {book.people.map((p) => (
                      <option key={p.id} value={p.name} />
                    ))}
                  </datalist>
                </label>
              )}
              {n.account && (
                <div className="min-w-40 flex-1 text-xs font-medium">
                  <span>{picking === "CREDIT_CARD_PAYMENT" ? "Which card?" : picking === "LOAN_REPAYMENT" ? "Which loan?" : row.direction === "debit" ? "Moved to" : "Moved from"}</span>
                  <CounterAccountSelect
                    type={picking}
                    excludeId={row.accountId}
                    value={form.account}
                    onChange={(v) => setForm({ ...form, account: v })}
                    className="mt-1"
                    ariaLabel="Account"
                  />
                </div>
              )}
              {n.holding && (
                <label className="min-w-40 flex-1 text-xs font-medium">
                  Which investment?
                  <Input value={form.holding} onChange={(e) => setForm({ ...form, holding: e.target.value })} placeholder="e.g. Zerodha" className="mt-1" aria-label="Investment" />
                </label>
              )}
              <Button size="sm" disabled={!fieldsOk} onClick={() => submit(picking, form)} data-testid="save-choice">
                <ArrowRight /> Save
              </Button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}

export type { Classification };
