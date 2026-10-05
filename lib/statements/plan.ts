import type { Category } from "@/lib/domain/types";
import * as ops from "@/lib/finance/book-ops";
import { statementShape } from "@/lib/finance/duplicates";
import { buildLedger } from "@/lib/finance/engine";
import { formatRupees } from "@/lib/finance/describe";
import { STATEMENT_ACCOUNT_TYPES, type Book, type EventDraft, type EventSource } from "@/lib/finance/types";
import { cashEffects } from "./match";
import { isDirectionCompatible } from "./rules";
import { PERSON_EVENTS, SUPPORTED_EVENT_TYPES, type Classification, type ImportRecord, type StatementRow } from "./types";

export interface PlanContext {
  expenseCategories: Category[];
  incomeCategories: Category[];
}

const byName = (list: Category[], name: string | null | undefined) => {
  const n = name?.trim().toLowerCase();
  return n ? list.find((c) => c.name.toLowerCase() === n || c.id.toLowerCase() === n) : undefined;
};

export const resolveCategoryId = (ctx: PlanContext, kind: "expense" | "income", name: string | null | undefined): string => {
  const list = kind === "expense" ? ctx.expenseCategories : ctx.incomeCategories;
  return (byName(list, name) ?? byName(list, kind === "expense" ? "Other" : "Other income") ?? list[list.length - 1])?.id ?? (kind === "expense" ? "other" : "other-income");
};

/** What is still missing before this classification can become an entry (null = nothing). */
export function missingInfo(row: StatementRow, c: Classification, book: Book): string | null {
  if (!SUPPORTED_EVENT_TYPES.includes(c.eventType)) return "This kind of entry can't be created from a statement yet. Pick another option or skip it.";
  if (!isDirectionCompatible(c.eventType, row.direction)) return `A ${row.direction} can't be recorded as this.`;
  if (PERSON_EVENTS.includes(c.eventType) && !c.person?.trim()) return "Who is this with?";
  if ((c.eventType === "INVESTMENT" || c.eventType === "INVESTMENT_SELL") && !c.holding?.trim()) return "Which investment?";
  const needsOther = c.eventType === "TRANSFER" || c.eventType === "CREDIT_CARD_PAYMENT" || c.eventType === "LOAN_REPAYMENT";
  if (needsOther) {
    const other = book.accounts.find((a) => a.id === c.counterAccountId);
    if (!other) {
      return c.eventType === "CREDIT_CARD_PAYMENT" ? "Which credit card was paid?" : c.eventType === "LOAN_REPAYMENT" ? "Which loan was this for?" : "Which of your accounts did it go to / come from?";
    }
    if (other.id === row.accountId) return "That's the same account as the statement.";
    if (c.eventType === "CREDIT_CARD_PAYMENT" && other.type !== "credit_card") return "Choose a credit card account.";
    if (c.eventType === "LOAN_REPAYMENT" && other.type !== "loan") return "Choose a loan account.";
  }
  return null;
}

export type DraftResult = { ok: true; draft: EventDraft; book: Book } | { ok: false; message: string };

/** Turns one classified line into an engine event draft. May add the person / investment it names to the working book. */
export function draftFor(row: StatementRow, c: Classification, ctx: PlanContext, book: Book, clock: ops.Clock): DraftResult {
  const missing = missingInfo(row, c, book);
  if (missing) return { ok: false, message: missing };

  const base = {
    date: row.transactionDate,
    description: (c.merchant || row.normalized.counterparty || row.normalizedDescription || row.rawDescription).slice(0, 120),
  };
  const amountMinor = row.amountMinor;
  const accountId = row.accountId;
  let working = book;

  const person = (): string | null => {
    const r = ops.ensurePerson(working, c.person ?? "", clock);
    if (!r) return null;
    working = r.book;
    return r.person.id;
  };
  const holding = (): string | null => {
    const r = ops.ensureInvestment(working, c.holding ?? "", row.transactionDate, clock);
    if (!r) return null;
    working = r.book;
    return r.account.id;
  };

  let draft: EventDraft | null = null;
  switch (c.eventType) {
    case "EXPENSE":
      draft = { type: "expense", ...base, accountId, amountMinor, categoryId: resolveCategoryId(ctx, "expense", c.category) };
      break;
    case "INCOME":
      draft = { type: "income", ...base, accountId, amountMinor, categoryId: resolveCategoryId(ctx, "income", c.category) };
      break;
    case "TRANSFER":
      draft =
        row.direction === "debit"
          ? { type: "transfer", ...base, fromAccountId: accountId, toAccountId: c.counterAccountId!, amountMinor }
          : { type: "transfer", ...base, fromAccountId: c.counterAccountId!, toAccountId: accountId, amountMinor };
      break;
    case "CREDIT_CARD_PAYMENT":
    case "LOAN_REPAYMENT":
      draft = { type: "transfer", ...base, fromAccountId: accountId, toAccountId: c.counterAccountId!, amountMinor };
      break;
    case "MONEY_LENT": {
      const id = person();
      if (id) draft = { type: "lend", ...base, personId: id, accountId, amountMinor };
      break;
    }
    case "MONEY_BORROWED": {
      const id = person();
      if (id) draft = { type: "borrow", ...base, personId: id, accountId, amountMinor };
      break;
    }
    case "LENDING_REPAYMENT": {
      const id = person();
      if (id) draft = { type: "repayment_received", ...base, personId: id, accountId, amountMinor, predatesRecords: true };
      break;
    }
    case "BORROWING_REPAYMENT": {
      const id = person();
      if (id) draft = { type: "repayment_made", ...base, personId: id, accountId, amountMinor, predatesRecords: true };
      break;
    }
    case "REIMBURSEMENT": {
      const id = person();
      if (id) {
        draft =
          row.direction === "credit"
            ? { type: "repayment_received", ...base, personId: id, accountId, amountMinor, predatesRecords: true }
            : { type: "reimbursable_expense", ...base, accountId, amountMinor, categoryId: resolveCategoryId(ctx, "expense", c.category), personId: id };
      }
      break;
    }
    case "INVESTMENT": {
      const id = holding();
      if (id) draft = { type: "invest", ...base, fromAccountId: accountId, holdingId: id, amountMinor };
      break;
    }
    case "INVESTMENT_SELL": {
      const id = holding();
      if (id) draft = { type: "sell_investment", ...base, holdingId: id, toAccountId: accountId, proceedsMinor: amountMinor };
      break;
    }
  }
  return draft ? { ok: true, draft, book: working } : { ok: false, message: "That couldn't be turned into an entry." };
}

/* ---------------- Commit ---------------- */

/** Statuses whose classification becomes a new entry. */
export const IMPORTABLE: StatementRow["status"][] = ["auto", "auto_flagged"];

export interface CommitFailure {
  rowId?: string;
  message: string;
}
export interface CommitOutcome {
  rowId: string;
  eventId: string;
  role: "created" | "matched";
}
export type CommitResult = { ok: true; book: Book; outcomes: CommitOutcome[] } | { ok: false; failures: CommitFailure[] };

/**
 * Applies a whole import to a copy of the book, through the same validated operations the rest of
 * the app uses. Either every line lands or none does: any failure returns the reasons and the
 * original book is untouched. Balances are never edited; they follow from the entries.
 */
export function buildCommit(book: Book, record: Pick<ImportRecord, "id" | "filename" | "accountId">, rows: StatementRow[], ctx: PlanContext, clock: ops.Clock = ops.systemClock): CommitResult {
  const account = book.accounts.find((a) => a.id === record.accountId);
  if (!account) return { ok: false, failures: [{ message: "The account for this statement no longer exists." }] };
  if (!STATEMENT_ACCOUNT_TYPES.includes(account.type)) return { ok: false, failures: [{ message: `“${account.name}” isn't a bank, cash or credit card account.` }] };

  const ordered = [...rows].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.index - b.index);
  const failures: CommitFailure[] = [];
  const outcomes: CommitOutcome[] = [];
  let working = book;
  const sourceFor = (row: StatementRow, role: EventSource["role"]): EventSource => ({
    kind: "statement",
    importId: record.id,
    rowId: row.id,
    filename: record.filename,
    line: row.index + 1,
    narration: row.rawDescription.slice(0, 200),
    fingerprint: row.fingerprint,
    role,
  });

  // Entries already created from OTHER statements (an overlapping period, or the same one in another format).
  // A line that matches one of them is linked to it instead of being added a second time.
  const fromOthers = new Map<string, string[]>();
  for (const e of book.events) {
    const src = e.sources?.find((s) => s.kind === "statement" && s.role === "created");
    if (!src || src.importId === record.id) continue;
    const key = statementShape(e);
    fromOthers.set(key, [...(fromOthers.get(key) ?? []), e.id]);
  }

  const created: { row: StatementRow; eventId: string }[] = [];
  for (const row of ordered) {
    if (!IMPORTABLE.includes(row.status)) continue;
    if (!row.classification) {
      failures.push({ rowId: row.id, message: `Line ${row.index + 1} hasn't been classified.` });
      continue;
    }
    const d = draftFor(row, row.classification, ctx, working, clock);
    if (!d.ok) {
      failures.push({ rowId: row.id, message: `Line ${row.index + 1} (${row.normalized.counterparty || row.rawDescription.slice(0, 30)}): ${d.message}` });
      continue;
    }
    const same = fromOthers.get(statementShape(d.draft as Parameters<typeof statementShape>[0]));
    const existingId = same?.shift();
    if (existingId) {
      const linked = ops.linkSource(working, existingId, sourceFor(row, "matched"));
      if (linked.ok) {
        working = linked.value;
        outcomes.push({ rowId: row.id, eventId: existingId, role: "matched" });
        continue;
      }
    }
    const draft = { ...d.draft, sources: [sourceFor(row, "created")] } as EventDraft;
    const added = ops.addEvent(d.book, draft, clock);
    if (!added.ok) {
      failures.push({ rowId: row.id, message: `Line ${row.index + 1} (${row.normalized.counterparty || "entry"} · ${formatRupees(row.amountMinor)}): ${added.issues[0]?.message ?? "the ledger rejected it"}` });
      continue;
    }
    working = added.value;
    const event = working.events[working.events.length - 1];
    created.push({ row, eventId: event.id });
    outcomes.push({ rowId: row.id, eventId: event.id, role: "created" });
  }

  for (const row of ordered) {
    if (row.status !== "matched_existing" || !row.eventId) continue;
    // Already linked by an earlier partial import of this statement.
    const target = working.events.find((e) => e.id === row.eventId);
    if (target?.sources?.some((s) => s.kind === "statement" && s.rowId === row.id)) continue;
    const linked = ops.linkSource(working, row.eventId, sourceFor(row, "matched"));
    if (!linked.ok) {
      failures.push({ rowId: row.id, message: `Line ${row.index + 1}: the matching entry no longer exists.` });
      continue;
    }
    working = linked.value;
    outcomes.push({ rowId: row.id, eventId: row.eventId, role: "matched" });
  }

  if (failures.length) return { ok: false, failures };

  // Final proof: each new entry moved this account by exactly what the bank shows.
  const effects = cashEffects(buildLedger(working));
  for (const { row, eventId } of created) {
    const want = row.direction === "credit" ? row.amountMinor : -row.amountMinor;
    const got = effects.get(eventId)?.get(row.accountId);
    if (got !== want) failures.push({ rowId: row.id, message: `Line ${row.index + 1} would not change ${account.name} by ${formatRupees(want)} as the statement shows.` });
  }
  if (failures.length) return { ok: false, failures };
  return { ok: true, book: working, outcomes };
}
